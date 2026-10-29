"""Business rules of the Open Charging & Investment module: queue, bids, financials, investment."""
from __future__ import annotations

import pytest

from app.services import charging_pricing as pricing
from app.services import charging_queue as q
from app.services import open_charging as oc
from app.services.charging_pricing import Bid, BidRound
from app.services.charging_queue import Arrival, Port, QueuePolicy, QueueRequest
from app.services.open_charging import Assumptions, EvaluateRequest

OPEN = {"vinfast": "confirmed", "tesla": "confirmed", "other": "confirmed"}


def arrival(vid: str, group: str, t: float, kwh: float = 30, **kw) -> Arrival:
    return Arrival(vehicle_id=vid, group=group, model=group, arrive_min=t, kwh=kwh, max_kw=60, **kw)


def run(arrivals, ports=None, policy=None, horizon=240):
    req = QueueRequest(policy=policy or QueuePolicy(), ports=ports or [Port(port_id="P1", power_kw=60, compat=OPEN)],
                       arrivals=arrivals, horizon_min=horizon)
    out = q.simulate(req)
    return out, {v["vehicle_id"]: v for v in out["vehicles"]}


# --- queue -------------------------------------------------------------------------------
def test_priority_vinfast_then_tesla_then_other():
    # P1 busy until ~35 min; three drivers queue behind it in reverse priority order
    out, v = run([arrival("X", "other", 0), arrival("O", "other", 1), arrival("T", "tesla", 2), arrival("V", "vinfast", 3)])
    assert v["V"]["start_min"] < v["T"]["start_min"] < v["O"]["start_min"]


def test_fifo_within_a_class():
    _, v = run([arrival("X", "other", 0), arrival("T2", "tesla", 1), arrival("T1", "tesla", 2)])
    assert v["T2"]["start_min"] < v["T1"]["start_min"]


def test_incompatible_vehicle_is_never_assigned():
    vf_only = [Port(port_id="P1", power_kw=60, compat={"vinfast": "confirmed", "tesla": "incompatible", "other": "incompatible"})]
    out, v = run([arrival("T", "tesla", 0), arrival("V", "vinfast", 5)], ports=vf_only)
    assert v["T"]["port_id"] is None and v["T"]["status"] == "waiting_at_end"
    assert v["V"]["port_id"] == "P1"
    assert any(row["blocked"] for snap in out["snapshots"] for row in snap["queue"] if row["vehicle_id"] == "T")


def test_unknown_compatibility_waits_for_verification():
    _, v = run([arrival("U", "other", 0, compat_known=False)])
    assert v["U"]["port_id"] is None


def test_unverified_port_only_when_allowed():
    ports = [Port(port_id="P1", power_kw=60, compat={"vinfast": "confirmed", "tesla": "unverified", "other": "confirmed"})]
    _, v = run([arrival("T", "tesla", 0)], ports=ports)
    assert v["T"]["port_id"] is None
    _, v = run([arrival("T", "tesla", 0)], ports=ports, policy=QueuePolicy(allow_unverified=True))
    assert v["T"]["port_id"] == "P1"


def test_active_session_is_never_interrupted():
    out, v = run([arrival("O", "other", 0, kwh=50), arrival("V", "vinfast", 1)])
    assert v["V"]["start_min"] >= v["O"]["end_min"]
    starts = [e for e in out["log"] if e["type"] == "start" and e["port_id"] == "P1"]
    completes = [e for e in out["log"] if e["type"] == "complete" and e["port_id"] == "P1"]
    assert starts[1]["t"] >= completes[0]["t"]


def test_outage_waits_for_session_end_and_updates_eta():
    ports = [Port(port_id="P1", power_kw=60, compat=OPEN, offline_from=5, offline_to=90)]
    out, v = run([arrival("A", "vinfast", 0, kwh=30), arrival("B", "vinfast", 2)], ports=ports)
    assert v["A"]["end_min"] > 5 and v["A"]["status"] == "completed"   # not cut off by the outage
    assert v["B"]["start_min"] >= 90
    # the outage is scheduled, so B's estimate already reflects it; without it B would start right after A
    eta = next(row["est_start_min"] for s in out["snapshots"] for row in s["queue"] if row["vehicle_id"] == "B")
    healthy, _ = run([arrival("A", "vinfast", 0, kwh=30), arrival("B", "vinfast", 2)])
    eta_healthy = next(row["est_start_min"] for s in healthy["snapshots"] for row in s["queue"] if row["vehicle_id"] == "B")
    assert eta >= 90 > eta_healthy


def test_eta_updates_after_arrival():
    out, _ = run([arrival("X", "other", 0, kwh=40), arrival("O", "other", 1), arrival("V", "vinfast", 10)])
    etas = [row["est_start_min"] for s in out["snapshots"] for row in s["queue"] if row["vehicle_id"] == "O"]
    assert etas[0] < etas[-1]   # a VinFast arrival pushed the other-brand driver back


def test_anti_starvation_only_when_configured():
    arr = [arrival("X", "vinfast", 0, kwh=20), arrival("O", "other", 1)] + [arrival(f"V{i}", "vinfast", 2 + i, kwh=20) for i in range(6)]
    _, off = run(arr)
    _, on = run(arr, policy=QueuePolicy(anti_starvation_min=20))
    assert not any(x["promoted"] for x in off.values())
    assert on["O"]["promoted"] is True
    assert on["O"]["start_min"] < off["O"]["start_min"]


def test_reserved_port_released_only_by_policy():
    ports = [Port(port_id="P1", power_kw=60, compat=OPEN), Port(port_id="P2", power_kw=60, compat=OPEN)]
    arr = [arrival("X", "other", 0, kwh=60), arrival("T", "tesla", 1)]
    _, v = run(arr, ports=ports, policy=QueuePolicy(reserved_vinfast_ports=1, reserve_release_idle_min=15))
    assert v["X"]["port_id"] == "P2"                                  # shared port used first
    assert v["T"]["port_id"] == "P1" and v["T"]["start_min"] >= 15   # reserved port released after 15 idle minutes
    _, v = run(arr, ports=ports, policy=QueuePolicy(reserved_vinfast_ports=1, reserve_release_idle_min=120))
    assert v["T"]["port_id"] == "P2"                                  # never released: waits for the shared port
    _, v = run(arr + [arrival("V", "vinfast", 20)], ports=ports, policy=QueuePolicy(reserved_vinfast_ports=1, reserve_release_idle_min=30))
    assert v["V"]["port_id"] == "P1" and v["T"]["port_id"] == "P2"   # VinFast arrives before release


def test_no_show_is_skipped_and_cancel_leaves():
    _, v = run([arrival("X", "other", 0), arrival("A", "vinfast", 1, no_show=True), arrival("C", "tesla", 2, cancel_min=10), arrival("O", "other", 3)])
    assert v["A"]["status"] == "absent" and v["C"]["status"] == "cancelled"
    assert v["O"]["port_id"] == "P1"


def test_demo_queue_is_reproducible_and_has_all_classes():
    a, b = q.simulate(QueueRequest()), q.simulate(QueueRequest())
    assert a["stats"] == b["stats"]
    assert all(a["stats"][g]["arrived"] > 0 for g in q.GROUPS)


# --- bids --------------------------------------------------------------------------------
def bids(*rows, slots=1):
    return pricing.run_bids(BidRound(eligible_slots=slots, bids=[Bid(**r) for r in rows]))


def by_id(res):
    return {b["bid_id"]: b for b in res["bids"]}


def test_higher_other_bid_cannot_override_tesla_or_vinfast():
    r = by_id(bids({"bid_id": "O", "group": "other", "max_price_vnd_per_kwh": 6900, "kwh": 30, "submitted_min": 0},
                   {"bid_id": "T", "group": "tesla", "max_price_vnd_per_kwh": 4000, "kwh": 30, "submitted_min": 5}))
    assert r["T"]["accepted"] and not r["O"]["accepted"]
    r = by_id(bids({"bid_id": "T", "group": "tesla", "max_price_vnd_per_kwh": 6900, "kwh": 30, "submitted_min": 0},
                   {"bid_id": "V", "group": "vinfast", "max_price_vnd_per_kwh": 3000, "kwh": 30, "submitted_min": 5}))
    assert r["V"]["accepted"] and not r["T"]["accepted"]


def test_equal_bids_earliest_wins_and_pay_as_bid():
    r = by_id(bids({"bid_id": "late", "group": "tesla", "max_price_vnd_per_kwh": 5000, "kwh": 40, "submitted_min": 9},
                   {"bid_id": "early", "group": "tesla", "max_price_vnd_per_kwh": 5000, "kwh": 40, "submitted_min": 3}))
    assert r["early"]["accepted"] and not r["late"]["accepted"]
    assert r["early"]["charged_incl_vat"] == 5000 * 40


def test_no_capacity_no_acceptance_no_charge():
    res = bids({"bid_id": "T", "group": "tesla", "max_price_vnd_per_kwh": 5000, "kwh": 40, "submitted_min": 0}, slots=0)
    assert res["accepted"] == 0 and res["revenue_incl_vat"] == 0


def test_bid_above_cap_rejected():
    r = by_id(bids({"bid_id": "T", "group": "tesla", "max_price_vnd_per_kwh": 9000, "kwh": 40, "submitted_min": 0}))
    assert not r["T"]["accepted"] and "cap" in r["T"]["reason"]


# --- financials --------------------------------------------------------------------------
SITE = next(s for s in oc.SITES if s["site_id"] == "OC-HCM-01")


def year1(a: Assumptions, scen="C"):
    return oc.year_one(SITE, a, scen, SITE["dc_ports"])[0]


def test_free_charging_is_not_driver_revenue_and_sponsor_only_when_configured():
    free = year1(Assumptions(vinfast_free_share_pct=100))
    assert free["driver_revenue"]["vinfast"] == pytest.approx(0, abs=1e-3)
    assert free["sponsor_reimbursement"] == 0
    sponsored = year1(Assumptions(vinfast_free_share_pct=100, sponsor_reimbursement_vnd_per_kwh=2000))
    assert sponsored["sponsor_reimbursement"] == pytest.approx(sponsored["free_kwh"] * 2000)


def test_changing_inputs_moves_the_numbers():
    base = year1(Assumptions())
    assert year1(Assumptions(tariff_tesla=5000))["operator_revenue"] > base["operator_revenue"]
    assert year1(Assumptions(energy_cost_vnd_per_kwh=3000))["contribution"] < base["contribution"]
    assert year1(Assumptions(demand_scale_pct=150))["kwh"]["vinfast"] > base["kwh"]["vinfast"]
    shared = year1(Assumptions(site_owner_share_pct=10))
    assert shared["site_owner_share"] == pytest.approx(0.10 * shared["operator_revenue"])
    assert shared["site_owner_share"] <= shared["operator_revenue"]


def test_roaming_does_not_double_count():
    direct, roaming = year1(Assumptions()), year1(Assumptions(operating_model="roaming", msp_margin_pct=12))
    tp = sum(roaming["driver_revenue"][g] for g in oc.THIRD_PARTY)
    assert roaming["msp_margin"] == pytest.approx(0.12 * tp)
    assert roaming["operator_revenue"] == pytest.approx(sum(roaming["driver_revenue"].values()) - roaming["msp_margin"])
    assert roaming["operator_revenue"] < direct["operator_revenue"]


def test_vat_basis_is_consistent():
    a = Assumptions(vat_pct=10)
    y = year1(a, "A")
    assert y["driver_revenue"]["vinfast"] == pytest.approx(y["paid_kwh"]["vinfast"] * a.tariff_vinfast / 1.1)
    assert y["vat_collected"] == pytest.approx(sum(y["driver_revenue"].values()) * 0.1)


def test_roi_payback_and_edge_cases():
    m = oc.investment_metrics(100, [30, 40, 50], 0)
    assert m["simple_roi_pct"] == pytest.approx(20.0)
    assert m["payback_years"] == pytest.approx(2.6)   # cumulative 30, 70 -> 120: 2 + 30/50
    zero = oc.investment_metrics(0, [10, 10], 10)
    assert zero["simple_roi_pct"] is None and "Not applicable" in zero["roi_note"]
    neg = oc.investment_metrics(100, [-10, -10], 10)
    assert neg["payback_years"] is None and neg["payback_note"] == "No payback within modeled horizon."
    assert neg["irr_pct"] is None


def test_roi_uses_incremental_cash_flow():
    a = Assumptions()
    opt = oc.evaluate_option(SITE, "open_spare", a)
    base = oc.annual_profits(SITE, a, "A", SITE["dc_ports"])
    hyb = oc.annual_profits(SITE, a, "C", SITE["dc_ports"])
    assert opt["cash_flows"] == pytest.approx([h - b for h, b in zip(hyb, base)])
    assert opt["capex"]["total"] == pytest.approx(sum(opt["capex"]["items"].values()))


def test_portfolio_reconciles_with_sites():
    res = oc.evaluate(EvaluateRequest())
    for s in ("A", "B", "C"):
        total = sum(site["scenarios"][s]["year1"]["operator_revenue"] for site in res["sites"] if site["scenarios"][s])
        assert res["portfolio"][s]["operator_revenue"] == pytest.approx(total)
    assert res["portfolio"]["C"]["incremental_revenue"] == pytest.approx(res["portfolio"]["C"]["operator_revenue"] - res["portfolio"]["A"]["operator_revenue"])


# --- investment ---------------------------------------------------------------------------
def test_recommendations_cover_the_demo_story():
    res = {s["site_id"]: s for s in oc.evaluate(EvaluateRequest())["sites"]}
    assert res["OC-HCM-01"]["recommendation"]["action"] == "Open selected spare capacity"
    assert res["OC-HCM-02"]["recommendation"]["action"] == "Keep VinFast-only"       # congested
    assert res["OC-HN-01"]["recommendation"]["action"] == "Upgrade capacity"
    assert res["OC-COR-02"]["recommendation"]["action"] == "Investigate further"     # grid unknown
    # 80 % of VinFast charging is free (3-year programme): a new build only pays when that is reimbursed
    assert res["OC-AIR-LTH"]["recommendation"]["action"] == "Investigate further"
    assert any("free" in r for r in res["OC-AIR-LTH"]["recommendation"]["reasons"])
    reimbursed = {s["site_id"]: s for s in oc.evaluate(EvaluateRequest(assumptions=Assumptions(sponsor_reimbursement_vnd_per_kwh=2400)))["sites"]}
    assert reimbursed["OC-AIR-LTH"]["recommendation"]["action"] == "Develop new hybrid site"
    for s in res.values():
        assert "SYNTHETIC SITE" in s["labels"]


def test_missing_grid_is_unknown_not_confirmed_and_not_zero_filled():
    site = next(s for s in oc.evaluate(EvaluateRequest())["sites"] if s["site_id"] == "OC-COR-02")
    assert site["grid"] == "unknown"
    grid = next(b for b in site["score"]["breakdown"] if b["factor"] == "grid_feasibility")
    assert grid["missing"] and grid["value"] is None and grid["contribution"] is None
    assert site["score"]["completeness"] < 1
    assert sum(b["contribution"] or 0 for b in site["score"]["breakdown"]) == pytest.approx(site["score"]["score"], abs=0.2)
    assert {b["factor"] for b in site["score"]["breakdown"]} == set(oc.WEIGHTS)


def test_weights_change_the_score():
    a = oc.evaluate(EvaluateRequest())["sites"][0]["score"]["score"]
    w = dict(oc.WEIGHTS, corridor_coverage=1.0)
    b = oc.evaluate(EvaluateRequest(weights=w))["sites"][0]["score"]["score"]
    assert a != b


def test_tight_wait_target_flags_congested_site():
    res = oc.evaluate(EvaluateRequest(assumptions=Assumptions(target_vinfast_avg_wait_min=1)))
    site = next(s for s in res["sites"] if s["site_id"] == "OC-HCM-01")
    assert site["recommendation"]["action"] != "Open selected spare capacity"


# --- API ---------------------------------------------------------------------------------
def test_open_charging_api(client):
    meta = client.get("/api/open-charging/meta").json()
    assert "No Tesla, VinFast, or V-Green partnership" in meta["disclaimer"]
    ev = client.post("/api/open-charging/evaluate", json={}).json()
    assert len(ev["sites"]) == len(oc.SITES)
    assert client.post("/api/open-charging/queue/simulate", json={}).json()["snapshots"]
    assert client.post("/api/open-charging/quote", json={"group": "tesla", "kwh": 40}).json()["total_incl_vat"] == 160000
    assert client.post("/api/open-charging/bids/simulate", json={"bids": [b.model_dump() for b in pricing.demo_bids()]}).json()["accepted"] == 2
    assert client.post("/api/open-charging/pilot", json={}).json()["sites"]
    saved = client.post("/api/open-charging/scenarios", json={"name": "Test"}).json()
    assert saved["provenance"] == "manually entered assumptions"
    assert any(s["scenario_id"] == saved["scenario_id"] for s in client.get("/api/open-charging/scenarios").json())
    assert client.post("/api/open-charging/evaluate", json={"assumptions": {"vat_pct": 99}}).status_code == 422


def test_existing_charging_api_still_works(client):
    assert client.get("/api/chargers/recommendations").status_code == 200


def test_grid_api_assigns_every_station(client):
    chargers = client.get("/api/chargers").json()
    grid = client.get("/api/chargers/grid").json()
    assert set(grid["stations"]) == {c["station_id"] for c in chargers}
    assert sum(len(n["stations"]) for n in grid["nodes"]) == len(chargers)
    assert "SYNTHETIC" in grid["note"]
