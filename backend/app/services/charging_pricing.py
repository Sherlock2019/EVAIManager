"""Transparent price quotes and a pay-as-bid slot simulator.

ILLUSTRATIVE PRICING, SIMULATION ONLY. No real payment, auction or roaming
access is involved; real-world pricing and bidding need legal and commercial review.

Quote (all tariffs VAT-inclusive, as the driver sees them):
    energy        = kWh * tariff
    discount      = VinFast discount, and free kWh for eligible VinFast drivers
    total         = energy - discount + session fee
    VAT included  = total - total / (1 + VAT)
Free kWh are never driver revenue. A sponsor pays only if a reimbursement rate is configured.

Bid round (pay-as-bid):
    eligible      not cancelled, submitted before the round closes, not expired,
                  max price >= the group's published fixed tariff, max price <= operator price cap
    ranking       priority class first (VinFast, Tesla, other), then highest bid,
                  then earliest submission, then bid id. A higher bid never jumps a class.
    acceptance    the first N eligible bids, N = eligible unreserved slots; N = 0 accepts nothing
    charge        accepted bidder pays the submitted price per kWh, fixed before the session
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from app.services.open_charging import Assumptions

Group = Literal["vinfast", "tesla", "other"]
PRIORITY = {"vinfast": 1, "tesla": 2, "other": 3}
PRICE_VALID_MIN = 30          # a quote holds for this long


class QuoteRequest(BaseModel):
    group: Group = "tesla"
    kwh: float = Field(40, gt=0, le=200)
    vinfast_free_eligible: bool = False
    assumptions: Assumptions = Assumptions()


def quote(req: QuoteRequest) -> dict[str, Any]:
    a = req.assumptions
    vat = 1 + a.vat_pct / 100
    tariff = a.tariff(req.group)
    energy = req.kwh * tariff
    discount = 0.0
    free_kwh = 0.0
    if req.group == "vinfast":
        if req.vinfast_free_eligible:
            free_kwh = req.kwh
            discount = energy
        else:
            discount = energy * a.vinfast_discount_pct / 100
    fee = a.third_party_session_fee_vnd if req.group != "vinfast" else 0.0
    total = energy - discount + fee
    sponsor = free_kwh * a.sponsor_reimbursement_vnd_per_kwh
    if total > 0:
        payer = "driver"
    elif sponsor > 0:
        payer = "sponsor (modelled reimbursement agreement)"
    else:
        payer = "nobody: free charging, operator absorbs the cost (not counted as revenue)"
    return {
        "group": req.group, "kwh": req.kwh, "price_per_kwh": tariff,
        "lines": [
            {"label": f"Energy {req.kwh:g} kWh × {tariff:,.0f} VND", "amount": energy},
            {"label": "Discount / free charging", "amount": -discount},
            {"label": "Session fee", "amount": fee},
        ],
        "total_incl_vat": total, "vat_included": total - total / vat, "total_excl_vat": total / vat,
        "vat_pct": a.vat_pct, "sponsor_pays_excl_vat": sponsor, "payer": payer,
        "valid_minutes": PRICE_VALID_MIN,
        "note": "ILLUSTRATIVE PRICING. Not a current tariff of any operator. Final price shown before the driver accepts.",
    }


class Bid(BaseModel):
    bid_id: str
    group: Group
    max_price_vnd_per_kwh: float = Field(gt=0, le=50000)
    kwh: float = Field(gt=0, le=200)
    submitted_min: float = Field(ge=0)
    expires_min: float | None = None
    cancelled: bool = False


class BidRound(BaseModel):
    slot_start_min: float = Field(60, ge=0)
    eligible_slots: int = Field(2, ge=0, le=50, description="unreserved capacity the operator opens to bids")
    price_cap_vnd_per_kwh: float = Field(7000, gt=0, le=50000)
    walk_in_wait_min: dict[str, float] = Field(default_factory=lambda: {"vinfast": 3, "tesla": 12, "other": 20})
    bids: list[Bid]
    assumptions: Assumptions = Assumptions()


def run_bids(req: BidRound) -> dict[str, Any]:
    a = req.assumptions
    vat = 1 + a.vat_pct / 100
    results: dict[str, dict[str, Any]] = {}
    eligible = []
    for b in req.bids:
        floor = a.tariff(b.group)
        reason = None
        if b.cancelled:
            reason = "Cancelled by driver"
        elif b.submitted_min > req.slot_start_min:
            reason = "Submitted after bidding closed"
        elif b.expires_min is not None and b.expires_min < req.slot_start_min:
            reason = "Expired before the slot starts"
        elif b.max_price_vnd_per_kwh > req.price_cap_vnd_per_kwh:
            reason = f"Above the operator price cap ({req.price_cap_vnd_per_kwh:,.0f} VND/kWh)"
        elif b.max_price_vnd_per_kwh < floor:
            reason = f"Below the published fixed price ({floor:,.0f} VND/kWh): use the fixed price instead"
        results[b.bid_id] = {**b.model_dump(), "priority": PRIORITY[b.group], "base_tariff": floor,
                             "accepted": False, "reason": reason, "charged_incl_vat": 0.0, "charged_excl_vat": 0.0}
        if reason is None:
            eligible.append(b)

    eligible.sort(key=lambda b: (PRIORITY[b.group], -b.max_price_vnd_per_kwh, b.submitted_min, b.bid_id))
    for rank, b in enumerate(eligible, start=1):
        r = results[b.bid_id]
        r["rank"] = rank
        if rank <= req.eligible_slots:
            charged = b.max_price_vnd_per_kwh * b.kwh
            r.update(accepted=True, reason=f"Accepted: rank {rank} of {req.eligible_slots} slots (pay-as-bid)",
                     charged_incl_vat=charged, charged_excl_vat=charged / vat)
        elif req.eligible_slots == 0:
            r["reason"] = "No eligible capacity: nothing accepted, nothing charged"
        else:
            last = eligible[req.eligible_slots - 1]
            if PRIORITY[last.group] < PRIORITY[b.group]:
                r["reason"] = f"Slots filled by higher-priority class ({last.group}); a higher bid cannot override priority"
            else:
                r["reason"] = "Outbid within the same priority class" if last.max_price_vnd_per_kwh > b.max_price_vnd_per_kwh else "Tie lost: earlier bid wins"

    rows = list(results.values())
    for r in rows:
        walk = req.walk_in_wait_min.get(r["group"], 0.0)
        r["impact"] = (f"Guaranteed slot at the start time, avoiding an estimated {walk:g} min walk-in wait"
                       if r["accepted"] else f"Can still charge as walk-in at the fixed price (est. wait {walk:g} min)")
    accepted = [r for r in rows if r["accepted"]]
    return {
        "bids": rows,
        "accepted": len(accepted),
        "slots": req.eligible_slots,
        "revenue_incl_vat": sum(r["charged_incl_vat"] for r in accepted),
        "revenue_excl_vat": sum(r["charged_excl_vat"] for r in accepted),
        "walk_in_capacity_note": f"{len(accepted)} slot(s) removed from walk-in capacity at the slot start time.",
        "rules": "Priority class first, then highest bid, then earliest submission. Pay-as-bid. No active session is interrupted.",
        "note": "SIMULATED BID ROUND. Not a live auction or payment. Real pricing and bidding need legal and commercial review.",
    }


def demo_bids() -> list[Bid]:
    return [
        Bid(bid_id="B1", group="other", max_price_vnd_per_kwh=6500, kwh=35, submitted_min=5),
        Bid(bid_id="B2", group="tesla", max_price_vnd_per_kwh=4800, kwh=40, submitted_min=12),
        Bid(bid_id="B3", group="vinfast", max_price_vnd_per_kwh=3500, kwh=30, submitted_min=20),
        Bid(bid_id="B4", group="tesla", max_price_vnd_per_kwh=4800, kwh=45, submitted_min=8),
        Bid(bid_id="B5", group="other", max_price_vnd_per_kwh=8000, kwh=30, submitted_min=3),
        Bid(bid_id="B6", group="tesla", max_price_vnd_per_kwh=3800, kwh=40, submitted_min=15),
        Bid(bid_id="B7", group="other", max_price_vnd_per_kwh=5000, kwh=30, submitted_min=30, cancelled=True),
    ]
