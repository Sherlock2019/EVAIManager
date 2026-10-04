"""Service schedule optimisation.

Greedy, explainable planner: vehicles are taken most-urgent first, sent to the
nearest service centre in their city and placed on the earliest day that has a
free bay, respecting the predicted service window and parts availability.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from app.data import geo
from app.data.generator import VN_TZ
from app.data.repository import Repository

# component key -> (service hours, parts lead time in days; 0 = in stock)
SERVICE_PROFILE: dict[str, tuple[float, int]] = {
    "thermal": (4.0, 2), "battery": (6.0, 3), "tires": (1.0, 0), "motor": (5.0, 2), "brakes": (2.0, 0), "charging": (2.5, 1),
}
BAY_HOURS_PER_DAY = 8.0
SEVERITY_ORDER = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2}


def _nearest_center(v: dict[str, Any]) -> dict[str, Any]:
    local = [c for c in geo.SERVICE_CENTERS if c["city"] == v["city"]] or geo.SERVICE_CENTERS
    return min(local, key=lambda c: geo.haversine_km(v["latitude"], v["longitude"], c["lat"], c["lon"]))


def optimize_schedule(repo: Repository) -> dict[str, Any]:
    today = date.today()
    cases = [p for p in repo.predictions.values() if p["maintenance_risk"] in SEVERITY_ORDER]
    cases.sort(key=lambda p: (SEVERITY_ORDER[p["maintenance_risk"]], -p["maintenance_probability"]))

    load: dict[tuple[str, int], float] = {}   # (center, day offset) -> booked hours
    plan: dict[str, dict[str, Any]] = {}
    late = 0
    for p in cases:
        v = repo.get_vehicle(p["vehicle_id"])
        assert v is not None
        center = _nearest_center(v)
        hours, lead = SERVICE_PROFILE[p["component_key"]]
        # Critical vehicles are pulled in even before parts arrive (diagnosis first).
        day = 0 if p["maintenance_risk"] == "CRITICAL" else lead
        capacity = center["bays"] * BAY_HOURS_PER_DAY
        while load.get((center["id"], day), 0.0) + hours > capacity:
            day += 1
        load[(center["id"], day)] = load.get((center["id"], day), 0.0) + hours
        window = p["predicted_days_to_service"] or 30
        if day > window:
            late += 1
        entry = plan.setdefault(center["id"], {"center": center, "days": {}, "vehicles": 0, "hours": 0.0})
        entry["vehicles"] += 1
        entry["hours"] += hours
        entry["days"].setdefault(day, []).append({
            "vehicle_id": p["vehicle_id"], "model": p["model"], "risk": p["maintenance_risk"],
            "probability": p["maintenance_probability"], "component": p["predicted_component"],
            "duration_h": hours, "parts": "In stock" if lead == 0 else f"Arrives in {lead}d",
            "distance_km": round(geo.haversine_km(v["latitude"], v["longitude"], center["lat"], center["lon"]), 1),
            "window_days": window, "within_window": day <= window,
        })

    centers = []
    for entry in plan.values():
        days = [{"day_offset": d, "date": (today + timedelta(days=d)).isoformat(), "jobs": jobs,
                 "hours": sum(j["duration_h"] for j in jobs)} for d, jobs in sorted(entry["days"].items())]
        c = entry["center"]
        centers.append({"id": c["id"], "name": c["name"], "city": c["city"], "bays": c["bays"],
                        "vehicles": entry["vehicles"], "hours": entry["hours"], "days": days[:6],
                        "peak_load_pct": round(100 * max(d["hours"] for d in days) / (c["bays"] * BAY_HOURS_PER_DAY))})
    centers.sort(key=lambda c: c["vehicles"], reverse=True)
    return {
        "summary": {
            "vehicles_scheduled": len(cases),
            "service_centers": len(centers),
            "critical_same_day": sum(1 for p in cases if p["maintenance_risk"] == "CRITICAL"),
            "within_window_pct": round(100 * (len(cases) - late) / max(1, len(cases))),
            "total_service_hours": round(sum(c["hours"] for c in centers)),
        },
        "grouping": ["severity", "location", "available service center", "parts availability", "estimated service duration"],
        "centers": centers,
    }


def book(repo: Repository, vehicle_id: str) -> dict[str, Any]:
    v = repo.get_vehicle(vehicle_id)
    if v is None:
        raise KeyError(vehicle_id)
    p = repo.predictions[v["vehicle_id"]]
    existing = next((b for b in repo.bookings if b["vehicle_id"] == v["vehicle_id"]), None)
    if existing:
        return existing
    center = _nearest_center(v)
    days = min(p["predicted_days_to_service"] or 14, 14)
    booking = {
        "vehicle_id": v["vehicle_id"],
        "component": p["predicted_component"] if p["predicted_component"] != "None" else "General inspection",
        "service_center": center["name"],
        "scheduled_for": (date.today() + timedelta(days=max(1, days - 1))).isoformat(),
        "created_at": datetime.now(VN_TZ).isoformat(timespec="seconds"),
    }
    repo.add_booking(booking)
    return booking
