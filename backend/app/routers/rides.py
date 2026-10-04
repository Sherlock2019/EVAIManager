from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from app.services import demand_model, ride_demand
from app.services.ride_demand import DayType
from app.state import repo

router = APIRouter(prefix="/api/rides", tags=["rides"])


@router.get("/forecast")
def forecast(day: DayType = "weekday") -> dict[str, Any]:
    """24-hour passenger demand, EV supply, origin-destination flows, driver
    repositioning and charger right-sizing for Ho Chi Minh City."""
    return ride_demand.forecast(repo, day)


@router.get("/model")
def model() -> dict[str, Any]:
    """Model card for the trained demand forecaster: data, held-out scores against the
    naive baseline, feature importance and predicted-versus-actual for the test week."""
    return demand_model.model_card(repo)


@router.get("/model/predict")
def predict(zone: int = Query(0, ge=0, le=13), hour: int = Query(18, ge=0, le=23),
            day_of_week: int = Query(4, ge=0, le=6, description="0 = Monday"), rain: bool = False) -> dict[str, Any]:
    """What-if: forecast pickups for one zone and hour, with and without rain."""
    return demand_model.predict(repo, zone, hour, day_of_week, rain)
