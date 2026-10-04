from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from app.services import route_analyzer
from app.state import repo

router = APIRouter(prefix="/api/routes", tags=["routes"])


@router.get("")
def list_routes() -> list[dict[str, Any]]:
    """Named EV routes with polylines, trip density and the vehicles currently on them."""
    return route_analyzer.route_summaries(repo)


@router.get("/heatmap")
def heatmap() -> dict[str, list[list[float]]]:
    """Travel density, charging demand and charger capacity as weighted points."""
    return route_analyzer.heatmap(repo)
