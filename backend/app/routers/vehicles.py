from __future__ import annotations

from typing import Any

import numpy as np
from fastapi import APIRouter, HTTPException, Query

from app.data import geo
from app.schemas.fleet import VehicleDetail, VehiclePage
from app.services import maintenance_engine, route_analyzer
from app.services.telemetry_service import STATUS_CODES
from app.state import repo

router = APIRouter(prefix="/api/vehicles", tags=["vehicles"])


def _require(vehicle_id: str) -> dict[str, Any]:
    v = repo.get_vehicle(vehicle_id)
    if v is None:
        raise HTTPException(404, f"Vehicle {vehicle_id} not found")
    return v


@router.get("", response_model=VehiclePage)
def list_vehicles(
    city: str | None = None,
    status: str | None = None,
    risk: str | None = None,
    q: str | None = Query(None, description="Search by vehicle id or model"),
    limit: int = Query(50, ge=1, le=2000),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    items = repo.vehicles
    if city:
        items = [v for v in items if v["city"] == city]
    if status:
        items = [v for v in items if v["status"] == status]
    if risk:
        items = [v for v in items if v["maintenance_risk"] == risk.upper()]
    if q:
        needle = q.lower()
        items = [v for v in items if needle in v["vehicle_id"].lower() or needle in v["model"].lower()]
    return {"total": len(items), "items": items[offset:offset + limit]}


@router.get("/map")
def map_points() -> dict[str, Any]:
    """Compact whole-fleet payload for map rendering.

    rows: [lat, lon, soc, status code, speed, corridor flag, on-route flag];
    ids/models are parallel arrays.
    """
    corridor = {r["route_id"] for r in repo.routes if r["kind"] == "corridor"}
    return {
        "status_codes": STATUS_CODES,
        "ids": [v["vehicle_id"] for v in repo.vehicles],
        "models": [v["model"] for v in repo.vehicles],
        "rows": [[v["latitude"], v["longitude"], v["battery_soc"], STATUS_CODES[v["status"]], round(v["speed_kmh"]),
                  1 if v.get("route_id") in corridor else 0, 1 if v.get("route_id") else 0] for v in repo.vehicles],
    }


@router.get("/{vehicle_id}", response_model=VehicleDetail)
def get_vehicle(vehicle_id: str) -> dict[str, Any]:
    v = _require(vehicle_id)
    p = repo.predictions[v["vehicle_id"]]
    spec = geo.VEHICLE_MODELS[v["model"]]
    booking = next((b for b in repo.bookings if b["vehicle_id"] == v["vehicle_id"]), None)
    return {
        "vehicle": v,
        "prediction": {**p, "booked": booking is not None},
        "estimated_range_km": maintenance_engine.estimated_range_km(v),
        "motor_efficiency_pct": int(min(98, round(94 * spec["wh_km"] / v["average_efficiency"] + 2))),
        "battery_kwh": spec["battery_kwh"],
        "digital_twin": maintenance_engine.digital_twin(v, p),
        "booking": booking,
    }


@router.get("/{vehicle_id}/telemetry")
def get_telemetry(vehicle_id: str, points: int = Query(48, ge=12, le=240)) -> dict[str, Any]:
    """Recent telemetry history (synthetic, deterministic per vehicle) ending at the live values."""
    v = _require(vehicle_id)
    rng = np.random.default_rng(int(v["vehicle_id"][-4:]) + 99)
    t = np.linspace(0, 1, points)
    risk = repo.predictions[v["vehicle_id"]]["component_risks"]

    def series(end: float, rise: float, noise: float, wave: float = 0.0) -> np.ndarray:
        # 'rise' is how much the signal climbed over the window (anomalies ramp up late)
        return end - rise * (1 - t ** 2.2) + rng.normal(0, noise, points) + wave * np.sin(t * 9)

    battery_temp = series(v["battery_temperature"], 13 * risk["thermal"], 0.35, 0.5)
    motor_temp = series(v["motor_temperature"], 24 * risk["motor"], 0.9, 2.0)
    soc = np.clip(v["battery_soc"] + (30 + 6 * np.sin(t * 5)) * (1 - t), 5, 100)  # ends at the live SOC
    speed = np.clip(34 + 22 * np.sin(t * 11) + rng.normal(0, 6, points), 0, 110)
    power = np.clip(speed * 0.32 + rng.normal(0, 2.5, points), 0, None)
    low_wheel = min(maintenance_engine.WHEEL_NAMES, key=lambda w: v[f"tire_pressure_{w}"])
    tire = series(v[f"tire_pressure_{low_wheel}"], -0.42 * risk["tires"], 0.006)
    return {
        "vehicle_id": v["vehicle_id"],
        "interval_minutes": 30,
        "low_wheel": low_wheel,
        "points": [
            {"t": f"-{(points - 1 - i) * 0.5:.1f}h", "battery_temperature": round(float(battery_temp[i]), 1),
             "motor_temperature": round(float(motor_temp[i]), 1), "battery_soc": round(float(soc[i]), 1),
             "speed_kmh": round(float(speed[i]), 1), "power_kw": round(float(power[i]), 1),
             "tire_pressure_low": round(float(tire[i]), 2)}
            for i in range(points)
        ],
    }


@router.get("/{vehicle_id}/route")
def get_route(vehicle_id: str) -> dict[str, Any]:
    """Today's trip: polyline, summary, timeline and replay samples."""
    return route_analyzer.vehicle_trip(repo, _require(vehicle_id))
