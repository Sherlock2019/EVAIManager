from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.services import charging_pricing, charging_queue, open_charging
from app.services.open_charging import Assumptions, EvaluateRequest, PilotRequest
from app.state import repo

router = APIRouter(prefix="/api/open-charging", tags=["open-charging"])

MAX_SAVED_SCENARIOS = 50


@router.get("/meta")
def meta() -> dict[str, Any]:
    """Defaults, labels and formulas the page shows next to every control."""
    return {
        "disclaimer": open_charging.DISCLAIMER,
        "assumptions": Assumptions().model_dump(),
        "weights": open_charging.WEIGHTS,
        "factor_labels": open_charging.FACTOR_LABEL,
        "scenario_labels": open_charging.SCENARIO_LABEL,
        "queue_policy": charging_queue.QueuePolicy().model_dump(),
        "demo_bids": [b.model_dump() for b in charging_pricing.demo_bids()],
        "formulas": {
            "incremental_revenue": "Hybrid scenario revenue − VinFast-only baseline revenue",
            "incremental_cash_flow": "Hybrid operating cash flow − baseline operating cash flow (per year)",
            "simple_roi": "(cumulative incremental net operating cash flow − incremental capex) / incremental capex × 100",
            "payback": "First point where cumulative incremental operating cash flow covers incremental capex (interpolated within the year)",
            "npv": "−capex + Σ CF_y / (1 + r)^y, end-of-year cash flows",
            "score": "Σ(weight × factor) / Σ(weights with data) × 100; missing factors excluded and reported",
            "wait": "M/M/c non-preemptive priority (Cobham), peak hour, one common mean service time",
        },
    }


@router.post("/evaluate")
def evaluate(req: EvaluateRequest) -> dict[str, Any]:
    """Score, wait estimate, revenue (A/B/C) and ROI options for every synthetic site."""
    return open_charging.evaluate(req)


@router.post("/queue/simulate")
def simulate_queue(req: charging_queue.QueueRequest) -> dict[str, Any]:
    return charging_queue.simulate(req)


@router.post("/quote")
def quote(req: charging_pricing.QuoteRequest) -> dict[str, Any]:
    return charging_pricing.quote(req)


@router.post("/bids/simulate")
def simulate_bids(req: charging_pricing.BidRound) -> dict[str, Any]:
    return charging_pricing.run_bids(req)


@router.post("/pilot")
def pilot(req: PilotRequest) -> dict[str, Any]:
    return open_charging.pilot(req)


class SavedScenario(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    assumptions: Assumptions = Assumptions()
    weights: dict[str, float] = Field(default_factory=lambda: dict(open_charging.WEIGHTS))


@router.get("/scenarios")
def list_scenarios() -> list[dict[str, Any]]:
    return repo.open_charging_scenarios


@router.post("/scenarios")
def save_scenario(body: SavedScenario) -> dict[str, Any]:
    """Saved assumption sets are user-provided assumptions, stored apart from any fleet or charger records."""
    row = {
        **body.model_dump(),
        "scenario_id": f"SC-{len(repo.open_charging_scenarios) + 1:03d}",
        "version": 1,
        "provenance": "manually entered assumptions",
        "currency": "VND",
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    repo.add_open_charging_scenario(row, MAX_SAVED_SCENARIOS)
    return row
