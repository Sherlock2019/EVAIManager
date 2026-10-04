from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from app.services import ride_demand
from app.services.ride_demand import DayType
from app.state import repo

router = APIRouter(prefix="/api/rides", tags=["rides"])


@router.get("/forecast")
def forecast(day: DayType = "weekday") -> dict[str, Any]:
    """24-hour passenger demand, EV supply, origin-destination flows, driver
    repositioning and charger right-sizing for Ho Chi Minh City."""
    return ride_demand.forecast(repo, day)
