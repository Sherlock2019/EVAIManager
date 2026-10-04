from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from app import config
from app.services import dashboard_service
from app.state import repo, sim

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/summary")
def get_summary() -> dict[str, Any]:
    """Executive KPIs for the header and the overview page."""
    return {**dashboard_service.summary(repo, sim), "disclaimer": config.DISCLAIMER}


@router.get("/insights")
def get_insights() -> list[dict[str, Any]]:
    """AI insight feed, derived from the fleet, charging and ADAS services."""
    return dashboard_service.insights(repo)


@router.get("/adas-events")
def get_adas_events() -> list[dict[str, Any]]:
    """Most recent simulated ADAS events (newest first)."""
    return list(sim.events)
