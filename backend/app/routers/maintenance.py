from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.schemas.fleet import MaintenancePrediction
from app.services import service_scheduler
from app.state import repo

router = APIRouter(prefix="/api/maintenance", tags=["maintenance"])


@router.get("/predictions", response_model=list[MaintenancePrediction])
def predictions(
    min_risk: str = Query("MEDIUM", description="LOW | MEDIUM | HIGH | CRITICAL"),
    limit: int = Query(200, ge=1, le=2000),
) -> list[dict[str, Any]]:
    """Vehicles ranked by maintenance probability."""
    order = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    floor = order.index(min_risk.upper()) if min_risk.upper() in order else 1
    booked = {b["vehicle_id"] for b in repo.bookings}
    rows = [{**p, "booked": p["vehicle_id"] in booked} for p in repo.predictions.values()
            if order.index(p["maintenance_risk"]) >= floor]
    rows.sort(key=lambda p: p["maintenance_probability"], reverse=True)
    return rows[:limit]


@router.get("/model")
def model_card() -> dict[str, Any]:
    """How the interpretable scoring model works."""
    return {
        "type": "Interpretable weighted risk score + IsolationForest anomaly feature",
        "features": ["battery degradation", "temperature anomalies", "charging frequency", "odometer",
                     "tire pressure trend", "motor temperature", "fault codes"],
        "bands": [{"level": "LOW", "range": "0–30%"}, {"level": "MEDIUM", "range": "31–60%"},
                  {"level": "HIGH", "range": "61–80%"}, {"level": "CRITICAL", "range": "81–100%"}],
        "outputs": ["maintenance_probability", "predicted_component", "predicted_days_to_service", "reason_codes"],
    }


@router.post("/optimize-schedule")
def optimize_schedule() -> dict[str, Any]:
    """Group at-risk vehicles by severity, location, service centre, parts and duration."""
    return service_scheduler.optimize_schedule(repo)


@router.post("/schedule/{vehicle_id}")
def schedule(vehicle_id: str) -> dict[str, Any]:
    try:
        return service_scheduler.book(repo, vehicle_id)
    except KeyError:
        raise HTTPException(404, f"Vehicle {vehicle_id} not found") from None
