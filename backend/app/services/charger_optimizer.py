"""AI charger planning engine.

Scores candidate sites, sizes expansions at existing stations and - just as
important - flags planned capacity that observed demand does not justify.

    site_score = 0.30 * route_density
               + 0.25 * charging_demand
               + 0.20 * distance_gap
               + 0.15 * predicted_ev_growth
               + 0.10 * accessibility          (each factor 0-1, score 0-100)
"""
from __future__ import annotations

import math
from typing import Any

from pydantic import BaseModel, Field

WEIGHTS = {"route_density": 0.30, "charging_demand": 0.25, "distance_gap": 0.20, "predicted_ev_growth": 0.15, "accessibility": 0.10}
RECOMMEND_THRESHOLD = 72.0      # minimum score to recommend building a new site
DISTANCE_GAP_CAP_KM = 8.0       # a gap this large (or more) scores 1.0
TARGET_UTILIZATION = 0.82       # expansions are sized to bring stations back to this
EXPAND_ABOVE = 0.95             # projected utilisation that triggers expansion
MONITOR_ABOVE = 0.80
LOW_BELOW = 0.35
COST_PER_PORT_USD = 35_000      # illustrative mock estimate


class Scenario(BaseModel):
    """What-if inputs. Defaults are the baseline the mock data was calibrated on."""
    ev_growth_pct: float = Field(30, ge=0, le=100)
    avg_daily_km: float = Field(40, ge=0, le=100)
    fast_charging_adoption_pct: float = Field(45, ge=0, le=100)
    peak_concentration_pct: float = Field(50, ge=0, le=100)


BASELINE = Scenario()


def _clip(x: float) -> float:
    return min(1.0, max(0.0, x))


def demand_multiplier(s: Scenario) -> float:
    """Relative charging demand versus baseline (1.0 at baseline)."""
    growth = (1 + s.ev_growth_pct / 100) / (1 + BASELINE.ev_growth_pct / 100)
    distance = 0.45 + 0.55 * s.avg_daily_km / BASELINE.avg_daily_km
    fast = 0.80 + 0.20 * s.fast_charging_adoption_pct / BASELINE.fast_charging_adoption_pct
    return growth * distance * fast


def peak_multiplier(s: Scenario) -> float:
    """Peak-hour stress: concentrated demand needs more ports for the same energy."""
    return 0.85 + 0.30 * s.peak_concentration_pct / 100


def score_site(site: dict[str, Any], s: Scenario) -> dict[str, Any]:
    dm = demand_multiplier(s)
    factors = {
        "route_density": _clip(site["route_density"] * (0.55 + 0.45 * s.avg_daily_km / BASELINE.avg_daily_km)),
        "charging_demand": _clip(site["charging_demand"] * dm * peak_multiplier(s)),
        "distance_gap": _clip(site["nearest_fast_km"] / DISTANCE_GAP_CAP_KM),
        "predicted_ev_growth": _clip(site["growth"] * (0.70 + s.ev_growth_pct / 100)),
        "accessibility": site["accessibility"],
    }
    score = 100 * sum(WEIGHTS[k] * v for k, v in factors.items())
    sessions = int(round(score ** 2 / 28.5 * min(1.6, dm)))
    return {
        "name": site["name"], "city": site["city"],
        "latitude": site["lat"], "longitude": site["lon"],
        "score": round(score),
        "score_raw": round(score, 1),
        "factors": {k: round(v, 2) for k, v in factors.items()},
        "contributions": {k: round(100 * WEIGHTS[k] * v, 1) for k, v in factors.items()},
        "expected_sessions_per_day": sessions,
        "recommended_ports": max(4, 2 * round(sessions / 52)),
        "nearest_fast_km": site["nearest_fast_km"],
        "nearby_utilization": site["nearby_utilization"],
        "reasons": site["reasons"],
        "recommended": score >= RECOMMEND_THRESHOLD,
        "action": "ADD" if score >= RECOMMEND_THRESHOLD else "MONITOR",
    }


def evaluate_station(st: dict[str, Any], s: Scenario) -> dict[str, Any]:
    """Decide EXPAND / MONITOR / KEEP / REDUCE for an existing station."""
    growth_scale = (s.ev_growth_pct / BASELINE.ev_growth_pct) if BASELINE.ev_growth_pct else 1.0
    forecast = st["forecast_90d_pct"] / 100 * growth_scale
    projected = st["utilization"] * (1 + forecast) * (demand_multiplier(s) / ((1 + s.ev_growth_pct / 100) / 1.3)) * peak_multiplier(s)
    add_ports = 0
    if projected >= EXPAND_ABOVE:
        action = "EXPAND"
        add_ports = min(12, max(2, math.ceil(st["ports"] * (projected / TARGET_UTILIZATION - 1) / 2) * 2))
        detail = f"Expand +{add_ports} charging points"
    elif projected >= MONITOR_ABOVE:
        action, detail = "MONITOR", "Approaching capacity — monitor weekly"
    elif projected < LOW_BELOW:
        action, detail = "REDUCE PLANNED CAPACITY", "Underutilized — do not add capacity"
    else:
        action, detail = "KEEP", "Capacity matches demand"
    return {
        "station_id": st["station_id"], "name": st["name"], "city": st["city"],
        "latitude": st["latitude"], "longitude": st["longitude"],
        "ports": st["ports"], "utilization": st["utilization"],
        "projected_utilization": round(projected, 2),
        "forecast_90d_pct": round(forecast * 100, 1),
        "action": action, "add_ports": add_ports, "detail": detail,
    }


def evaluate_planned(site: dict[str, Any], s: Scenario) -> dict[str, Any]:
    """Check a planned site against observed demand; may recommend NOT building."""
    growth_scale = (s.ev_growth_pct / BASELINE.ev_growth_pct) if BASELINE.ev_growth_pct else 1.0
    growth = site["growth"] * growth_scale
    projected = site["nearby_utilization"] * (1 + growth) * (demand_multiplier(s) / ((1 + s.ev_growth_pct / 100) / 1.3)) * peak_multiplier(s)
    unnecessary = projected < LOW_BELOW
    return {
        "name": site["name"], "city": site["city"],
        "latitude": site["lat"], "longitude": site["lon"],
        "planned_ports": site["planned_ports"],
        "nearby_utilization": site["nearby_utilization"],
        "nearby_chargers": site["nearby_chargers"],
        "predicted_demand_growth_pct": round(growth * 100, 1),
        "projected_utilization": round(projected, 2),
        "action": "DO NOT EXPAND" if unnecessary else ("PROCEED" if projected >= 0.6 else "MONITOR"),
        "avoided_investment_usd": site["planned_ports"] * COST_PER_PORT_USD if unnecessary else 0,
    }


def optimize(chargers: list[dict[str, Any]], candidates: list[dict[str, Any]], planned: list[dict[str, Any]], s: Scenario | None = None) -> dict[str, Any]:
    s = s or BASELINE
    sites = sorted((score_site(c, s) for c in candidates), key=lambda x: x["score_raw"], reverse=True)
    for rank, site in enumerate(sites, 1):
        site["rank"] = rank
    stations = [evaluate_station(st, s) for st in chargers]
    plans = [evaluate_planned(p, s) for p in planned]
    expansions = sorted((x for x in stations if x["action"] == "EXPAND"), key=lambda x: x["projected_utilization"], reverse=True)
    underused = sorted((x for x in stations if x["action"] == "REDUCE PLANNED CAPACITY"), key=lambda x: x["projected_utilization"])
    unnecessary = [p for p in plans if p["action"] == "DO NOT EXPAND"]
    counts: dict[str, int] = {}
    for x in stations:
        counts[x["action"]] = counts.get(x["action"], 0) + 1
    return {
        "scenario": s.model_dump(),
        "formula": "0.30·route_density + 0.25·charging_demand + 0.20·distance_gap + 0.15·predicted_EV_growth + 0.10·accessibility",
        "summary": {
            "current_stations": len(chargers),
            "current_ports": sum(c["ports"] for c in chargers),
            "new_stations": sum(1 for x in sites if x["recommended"]),
            "added_ports": sum(x["add_ports"] for x in expansions),
            "stations_to_expand": len(expansions),
            "underutilized_stations": len(underused),
            "unnecessary_planned_sites": len(unnecessary),
            "avoided_investment_usd": sum(p["avoided_investment_usd"] for p in unnecessary),
            "demand_multiplier": round(demand_multiplier(s), 2),
            "action_counts": counts,
        },
        "sites": sites,
        "expansions": expansions,
        "underutilized": underused,
        "planned_sites": plans,
        "station_actions": {x["station_id"]: {"action": x["action"], "add_ports": x["add_ports"], "detail": x["detail"], "projected_utilization": x["projected_utilization"]} for x in stations},
        "money_note": "Monetary values are illustrative mock estimates.",
    }
