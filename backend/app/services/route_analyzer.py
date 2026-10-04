"""Route intelligence: trip summaries, replayable trips and mobility heatmaps."""
from __future__ import annotations

from typing import Any

import numpy as np

from app.data import geo
from app.data.repository import Repository


def route_summaries(repo: Repository) -> list[dict[str, Any]]:
    on_route: dict[str, list[str]] = {}
    for v in repo.vehicles:
        if v.get("route_id"):
            on_route.setdefault(v["route_id"], []).append(v["vehicle_id"])
    return [{**r, "vehicles": on_route.get(r["route_id"], [])} for r in repo.routes]


def _vehicle_route(repo: Repository, v: dict[str, Any]) -> dict[str, Any]:
    """The vehicle's assigned route, or a deterministic one in its city."""
    if v.get("route_id"):
        return repo.route_index[v["route_id"]]
    local = [r for r in repo.routes if r["city"] == v["city"]] or repo.routes
    return local[int(v["vehicle_id"][-4:]) % len(local)]


def vehicle_trip(repo: Repository, v: dict[str, Any]) -> dict[str, Any]:
    """Today's trip for a vehicle with per-point samples for the replay animation."""
    route = _vehicle_route(repo, v)
    rng = np.random.default_rng(int(v["vehicle_id"][-4:]))
    coords = route["coords"]
    n = len(coords)
    seg = np.array([geo.haversine_km(a[0], a[1], b[0], b[1]) for a, b in zip(coords[:-1], coords[1:])]) * 1.18
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    wh_km = float(v["average_efficiency"])
    battery_kwh = geo.VEHICLE_MODELS[v["model"]]["battery_kwh"] * v["battery_soh"] / 100

    traffic_at, charge_at = int(n * 0.28), int(n * 0.55)
    corridor = route["kind"] == "corridor"
    cruise = 82.0 if corridor else 38.0
    start_minutes = 7 * 60 + 42
    soc = float(min(92.0, max(46.0, v["battery_soc"] + 18)))
    energy, minutes = 0.0, float(start_minutes)
    samples: list[dict[str, Any]] = []
    events = [{"time": _hhmm(minutes), "label": "Started", "detail": route["stops"][0], "index": 0, "type": "start"}]
    for i in range(n):
        in_traffic = traffic_at <= i < traffic_at + max(2, n // 9)
        speed = float(rng.uniform(8, 16)) if in_traffic else float(cruise * rng.uniform(0.85, 1.12))
        if i > 0:
            d = float(seg[i - 1])
            minutes += d / speed * 60
            used = d * wh_km / 1000 * (1.18 if in_traffic else 1.0)
            energy += used
            soc -= used / battery_kwh * 100
        if i == traffic_at:
            events.append({"time": _hhmm(minutes), "label": "Traffic", "detail": "Congestion — speed reduced", "index": i, "type": "traffic"})
        if i == charge_at:
            events.append({"time": _hhmm(minutes), "label": "Charging", "detail": f"Fast charge near {route['stops'][len(route['stops']) // 2]}", "index": i, "type": "charging"})
            samples.append(_sample(coords[i], minutes, 0.0, soc, energy, cum[i], "charging"))
            minutes += 26
            soc = min(90.0, soc + 34)
            events.append({"time": _hhmm(minutes), "label": "Departed", "detail": f"Charged to {soc:.0f}%", "index": i, "type": "depart"})
        samples.append(_sample(coords[i], minutes, 0.0 if i in (0, n - 1) else speed, soc, energy, cum[i], "traffic" if in_traffic else "driving"))
    events.append({"time": _hhmm(minutes), "label": "Destination", "detail": route["stops"][-1], "index": n - 1, "type": "arrive"})

    distance = float(cum[-1])
    return {
        "vehicle_id": v["vehicle_id"], "model": v["model"],
        "route_id": route["route_id"], "name": route["name"], "stops": route["stops"],
        "coords": coords,
        "summary": {
            "distance_today_km": round(distance, 1),
            "energy_consumed_kwh": round(energy, 1),
            "charging_stops": 1,
            "average_efficiency_wh_km": round(energy / distance * 1000) if distance else 0,
            "duration_min": round(minutes - start_minutes),
        },
        "timeline": events,
        "samples": samples,
    }


def _sample(pt: list[float], minutes: float, speed: float, soc: float, energy: float, km: float, state: str) -> dict[str, Any]:
    return {"lat": pt[0], "lon": pt[1], "time": _hhmm(minutes), "speed_kmh": round(speed, 1), "soc": round(soc, 1),
            "energy_kwh": round(energy, 2), "distance_km": round(float(km), 2), "state": state}


def _hhmm(minutes: float) -> str:
    m = int(round(minutes))
    return f"{(m // 60) % 24:02d}:{m % 60:02d}"


def heatmap(repo: Repository) -> dict[str, list[list[float]]]:
    """Three intensity layers as [lat, lon, weight 0-1] points."""
    rng = np.random.default_rng(11)
    travel: list[list[float]] = []
    max_trips = max(r["trips_per_day"] for r in repo.routes)
    for r in repo.routes:
        w = r["trips_per_day"] / max_trips
        step = 1 if r["kind"] == "urban" else 3
        for lat, lon in r["coords"][::step]:
            travel.append([lat + float(rng.normal(0, 0.0015)), lon + float(rng.normal(0, 0.0015)), round(0.35 + 0.65 * w, 2)])
    for z in geo.HCMC_ZONES.values():
        for _ in range(int(10 + 26 * z["demand"])):
            travel.append([float(rng.normal(z["lat"], 0.008)), float(rng.normal(z["lon"], 0.008)), round(z["demand"], 2)])
    for v in repo.vehicles[::4]:
        travel.append([v["latitude"], v["longitude"], 0.3])

    demand: list[list[float]] = []
    for z in geo.HCMC_ZONES.values():
        unmet = z["demand"] * (0.6 + 0.4 * z["growth"])
        for _ in range(int(8 + 24 * unmet)):
            demand.append([float(rng.normal(z["lat"], 0.007)), float(rng.normal(z["lon"], 0.007)), round(min(1.0, unmet), 2)])
    max_sessions = max(c["avg_daily_sessions"] for c in repo.chargers)
    for c in repo.chargers:
        demand.append([c["latitude"], c["longitude"], round(0.25 + 0.75 * c["avg_daily_sessions"] / max_sessions, 2)])
    for s in repo.candidate_sites:
        for _ in range(6):
            demand.append([float(rng.normal(s["lat"], 0.006)), float(rng.normal(s["lon"], 0.006)), round(s["charging_demand"], 2)])

    max_ports = max(c["ports"] for c in repo.chargers)
    capacity = [[c["latitude"], c["longitude"], round(0.3 + 0.7 * c["ports"] / max_ports, 2)] for c in repo.chargers]
    return {"travel_density": travel, "charging_demand": demand, "charger_capacity": capacity}
