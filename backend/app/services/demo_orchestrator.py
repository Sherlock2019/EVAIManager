"""Guided 11-step demo.

Each step performs a real state change through the normal services (the same
maintenance engine, optimizer and review workflow the UI uses), so what the
narration claims is what the dashboards then show. Step 1 resets the entities
the demo touches, which makes the sequence repeatable.
"""
from __future__ import annotations

import copy
from typing import Any

from app.data.generator import DEMO_FRAME_ID, DEMO_VEHICLE_ID
from app.data.repository import Repository, display_status
from app.schemas.adas import Correction, ReviewRequest
from app.services import charger_optimizer, model_metrics, review_service, service_scheduler

TOTAL_STEPS = 11
DEMO_STATION = "Thu Duc EV Hub"
DEMO_ROUTE_INDEX = 2            # District 1 → Binh Thanh → Thu Duc
BASE_FORECAST, BUMPED_FORECAST = 31.0, 36.0

_pristine_frame: dict[str, Any] | None = None
_base_trips: int | None = None


def _station(repo: Repository) -> dict[str, Any]:
    return next(c for c in repo.chargers if c["name"] == DEMO_STATION)


def _metric(label: str, before: Any, after: Any) -> dict[str, Any]:
    return {"label": label, "before": before, "after": after}


def _reset(repo: Repository) -> None:
    global _pristine_frame, _base_trips
    v = repo.get_vehicle(DEMO_VEHICLE_ID)
    assert v is not None
    clean = repo.pristine(DEMO_VEHICLE_ID)
    for key in ("battery_temperature", "fault_codes", "charging_cycles", "average_efficiency"):
        v[key] = clean[key]
    v["status"] = "healthy"
    p = repo.refresh_prediction(v)
    v["status"] = display_status(v, p)
    repo.bookings[:] = [b for b in repo.bookings if b["vehicle_id"] != DEMO_VEHICLE_ID]

    frame = repo.get_frame(DEMO_FRAME_ID)
    assert frame is not None
    if _pristine_frame is None:
        if frame["label_status"] != "pending_review":  # reviewed in an earlier session
            for o in frame["objects"]:
                o["source"] = "ai"
                if o["id"] == 3:
                    o.update(cls="motorcycle", confidence=0.58, bbox=[0.44, 0.55, 0.075, 0.12])
            frame["objects"] = [o for o in frame["objects"] if o["id"] <= 4]
        _pristine_frame = copy.deepcopy(frame)
    frame.update(copy.deepcopy(_pristine_frame))
    frame.update(label_status="pending_review", review_required=True, dataset_version=None)
    repo.save_frame(frame)

    _station(repo)["forecast_90d_pct"] = BASE_FORECAST
    route = repo.routes[DEMO_ROUTE_INDEX]
    if _base_trips is None:
        _base_trips = route["trips_per_day"]
    route["trips_per_day"] = _base_trips


def run_step(repo: Repository, step: int) -> dict[str, Any]:
    v = repo.get_vehicle(DEMO_VEHICLE_ID)
    frame = repo.get_frame(DEMO_FRAME_ID)
    assert v is not None and frame is not None
    station = _station(repo)
    route = repo.routes[DEMO_ROUTE_INDEX]
    vehicle_link = f"/fleet/health?vehicle={DEMO_VEHICLE_ID}"
    review_link = f"/adas/review?frame={DEMO_FRAME_ID}"

    if step == 1:
        _reset(repo)
        body = {"system": "FLEET", "title": "New vehicle telemetry arrives",
                "detail": f"{DEMO_VEHICLE_ID} ({v['model']}) streams battery, motor, tire and GPS signals through the vehicle gateway.",
                "metrics": [_metric("Battery temp", None, f"{v['battery_temperature']:.1f}°C"), _metric("SOC", None, f"{v['battery_soc']:.0f}%"),
                            _metric("Motor temp", None, f"{v['motor_temperature']:.0f}°C")],
                "link": vehicle_link}
    elif step == 2:
        before = v["battery_temperature"]
        v["battery_temperature"] = 47.8
        v["fault_codes"] = ["BMS-T01"]
        v["charging_cycles"] = int(v["charging_cycles_expected"] * 1.45)
        v["average_efficiency"] = round(v["average_efficiency"] * 1.13, 1)
        body = {"system": "FLEET", "title": "EV develops battery temperature anomaly",
                "detail": "Battery temperature climbs well above the fleet envelope while efficiency drops.",
                "metrics": [_metric("Battery temp", f"{before:.1f}°C", "47.8°C"), _metric("Fault code", "none", "BMS-T01")],
                "link": vehicle_link}
    elif step == 3:
        before = repo.predictions[DEMO_VEHICLE_ID]
        after = repo.refresh_prediction(v)
        v["status"] = display_status(v, after)
        body = {"system": "FLEET", "title": "Maintenance AI detects the anomaly",
                "detail": f"Predicted component: {after['predicted_component']}. " + "; ".join(after["reason_codes"][:3]) + ".",
                "metrics": [_metric("Maintenance risk", f"{before['maintenance_probability']:.0f}% {before['maintenance_risk']}",
                                    f"{after['maintenance_probability']:.0f}% {after['maintenance_risk']}"),
                            _metric("Health score", before["health_score"], after["health_score"])],
                "link": vehicle_link}
    elif step == 4:
        p = repo.predictions[DEMO_VEHICLE_ID]
        booking = service_scheduler.book(repo, DEMO_VEHICLE_ID)
        body = {"system": "FLEET", "title": "Service recommendation generated",
                "detail": f"{p['recommended_action']} at {booking['service_center']} on {booking['scheduled_for']} — "
                          f"{booking['component']}, within the {p['predicted_days_to_service']}-day service window.",
                "metrics": [_metric("Service window", None, f"{p['predicted_days_to_service']} days"), _metric("Booking", "none", "created")],
                "link": "/fleet/maintenance"}
    elif step == 5:
        before = route["trips_per_day"]
        route["trips_per_day"] = before + 14
        body = {"system": "CHARGING", "title": "Vehicle route feeds the charging-demand model",
                "detail": f"The trip {route['name']} is added to the mobility dataset; the corridor into Thu Duc gets denser.",
                "metrics": [_metric("Corridor trips/day", before, route["trips_per_day"])],
                "link": "/energy/routes"}
    elif step == 6:
        station["forecast_90d_pct"] = BUMPED_FORECAST
        body = {"system": "CHARGING", "title": "Charger demand prediction changes",
                "detail": f"{DEMO_STATION} already runs at {station['utilization'] * 100:.0f}% utilization; the 90-day forecast rises.",
                "metrics": [_metric("90-day demand forecast", f"+{BASE_FORECAST:.0f}%", f"+{BUMPED_FORECAST:.0f}%")],
                "link": "/energy/charging"}
    elif step == 7:
        station["forecast_90d_pct"] = BASE_FORECAST
        base = charger_optimizer.evaluate_station(station, charger_optimizer.BASELINE)
        station["forecast_90d_pct"] = BUMPED_FORECAST
        plan = charger_optimizer.optimize(repo.chargers, repo.candidate_sites, repo.planned_sites)
        now = plan["station_actions"][station["station_id"]]
        top = plan["sites"][0]
        body = {"system": "CHARGING", "title": "AI proposes charging capacity expansion",
                "detail": f"EXPAND {DEMO_STATION} and ADD {top['name']} (score {top['score']}/100). "
                          f"{plan['summary']['unnecessary_planned_sites']} planned sites remain unnecessary.",
                "metrics": [_metric(f"{DEMO_STATION} expansion", f"+{base['add_ports']} ports", f"+{now['add_ports']} ports"),
                            _metric("Projected utilization", f"{base['projected_utilization'] * 100:.0f}%", f"{now['projected_utilization'] * 100:.0f}%")],
                "link": "/energy/charging?optimize=1"}  # the map switches to the optimized plan
    elif step == 8:
        moto = next(o for o in frame["objects"] if o["id"] == 3)
        body = {"system": "ADAS", "title": "ADAS low-confidence frame detected",
                "detail": f"Frame {DEMO_FRAME_ID}: motorcycle between cars in heavy rain at dusk. Confidence is below 70%, "
                          "so the label is routed to mandatory human review instead of the training set.",
                "metrics": [_metric("Motorcycle confidence", None, f"{moto['confidence'] * 100:.0f}%"), _metric("Routing", "auto-label", "HUMAN REVIEW")],
                "link": review_link}
    elif step == 9:
        req = ReviewRequest(action="correct", reviewer="demo.reviewer",
                            corrections=[Correction(object_id=3, cls="motorcycle", confidence=1.0, bbox=[0.432, 0.535, 0.092, 0.150])])
        review_service.apply_review(repo, frame, req)
        body = {"system": "ADAS", "title": "Human corrects the motorcycle label",
                "detail": "The reviewer confirms the class and tightens the bounding box around the partly occluded rider.",
                "metrics": [_metric("Motorcycle label", "AI 58%", "Human verified"), _metric("Review queue", None, f"{len(repo.review_queue()):,} frames")],
                "link": review_link}
    elif step == 10:
        d = repo.dataset(review_service.BUILDING_VERSION)
        body = {"system": "ADAS", "title": "Frame enters the next training dataset",
                "detail": f"The corrected frame is versioned into {d['version']} together with its human label.",
                "metrics": [_metric(f"{d['version']} new frames", f"{d['frames_added'] - 1:,}", f"{d['frames_added']:,}"),
                            _metric("Human corrections", f"{d['human_corrections'] - 1:,}", f"{d['human_corrections']:,}")],
                "link": "/adas/datasets"}
    elif step == 11:
        c = model_metrics.build(review_service.session_corrections)["candidate"]
        body = {"system": "ADAS", "title": "Updated model metrics appear",
                "detail": "The simulated next model candidate, trained on the enriched dataset, improves on exactly the corrected scenario. (Mock demo data.)",
                "metrics": [_metric("Motorcycle recall", f"{c['baseline']['motorcycle_recall'] * 100:.1f}%", f"{c['motorcycle_recall'] * 100:.2f}%"),
                            _metric("mAP", f"{c['baseline']['map']:.3f}", f"{c['map']:.4f}")],
                "link": "/adas/metrics"}
    else:
        raise ValueError(f"step must be 1..{TOTAL_STEPS}")
    return {"step": step, "total": TOTAL_STEPS, **body}
