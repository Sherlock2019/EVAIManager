from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from app.schemas.fleet import Charger
from app.services import charger_optimizer, grid_capacity, observed_chargers
from app.services.charger_optimizer import Scenario
from app.state import repo

router = APIRouter(prefix="/api/chargers", tags=["chargers"])


@router.get("", response_model=list[Charger])
def list_chargers(city: str | None = None) -> list[dict[str, Any]]:
    """Charging stations with live availability and the AI recommendation per station."""
    actions = charger_optimizer.optimize(repo.chargers, repo.candidate_sites, repo.planned_sites)["station_actions"]
    rows = []
    for c in repo.chargers:
        if city and c["city"] != city:
            continue
        a = actions[c["station_id"]]
        rows.append({**c, "action": a["action"], "recommendation": a["detail"], "add_ports": a["add_ports"]})
    return rows


@router.get("/grid")
def grid() -> dict[str, Any]:
    """Synthetic power-grid nodes with EV hosting capacity versus the peak need of the stations they feed."""
    return grid_capacity.grid_view(repo.chargers)


@router.get("/observed")
def observed() -> dict[str, Any]:
    """Real charging-station locations from OpenStreetMap (+ Open Charge Map when keyed). Observed data, kept separate from the synthetic network."""
    return observed_chargers.build(repo.observed_raw())


@router.post("/observed/refresh")
def refresh_observed() -> dict[str, Any]:
    """Re-fetch from the open sources and cache the result. Falls back to the previous data if every source fails."""
    return observed_chargers.build(repo.refresh_observed())


@router.get("/recommendations")
def recommendations(scenario: Scenario = Depends()) -> dict[str, Any]:
    """Run the planning engine. Query parameters are the what-if sliders
    (ev_growth_pct, avg_daily_km, fast_charging_adoption_pct, peak_concentration_pct)."""
    return charger_optimizer.optimize(repo.chargers, repo.candidate_sites, repo.planned_sites, scenario)
