"""Power-grid capacity versus charging-station need.

SYNTHETIC GRID: node names, locations and capacities are invented for the
demo. They are not EVN substations or real grid data.

Each station is fed by the nearest grid node in its own city.

    installed (kW)      = ports * power_kw
    peak need (kW)      = installed * min(1, utilization * PEAK_COINCIDENCE)
    90-day need (kW)    = peak need * (1 + forecast_90d_pct / 100)
    node loading        = sum of station peak need / node EV hosting capacity
    status              = ok < WATCH_AT <= watch < CONSTRAINED_AT <= constrained; > 1.0 = over capacity
"""
from __future__ import annotations

import math
from typing import Any

PEAK_COINCIDENCE = 1.25   # peak-hour port use relative to the station's average utilization
WATCH_AT = 0.70
CONSTRAINED_AT = 0.90

# (node_id, name, city, lat, lon, EV hosting capacity MW). SYNTHETIC.
GRID_NODES: list[tuple[str, str, str, float, float, float]] = [
    ("GN-HCM-01", "District 1 grid node", "Ho Chi Minh City", 10.7790, 106.6990, 16.0),
    ("GN-HCM-02", "Thu Duc grid node", "Ho Chi Minh City", 10.8520, 106.7600, 8.5),
    ("GN-HCM-03", "Tan Binh grid node", "Ho Chi Minh City", 10.8040, 106.6500, 12.5),
    ("GN-HCM-04", "District 7 grid node", "Ho Chi Minh City", 10.7350, 106.7180, 9.5),
    ("GN-HCM-05", "Binh Thanh grid node", "Ho Chi Minh City", 10.8120, 106.7150, 11.0),
    ("GN-HCM-06", "Go Vap grid node", "Ho Chi Minh City", 10.8400, 106.6650, 7.0),
    ("GN-HCM-07", "Binh Tan grid node", "Ho Chi Minh City", 10.7680, 106.6080, 7.0),
    ("GN-HCM-08", "District 12 grid node", "Ho Chi Minh City", 10.8680, 106.6400, 4.0),
    ("GN-HCM-09", "Nha Be grid node", "Ho Chi Minh City", 10.6970, 106.7400, 8.0),
    ("GN-HCM-10", "Di An grid node", "Ho Chi Minh City", 10.9040, 106.7690, 6.0),
    ("GN-HAN-01", "Hoan Kiem grid node", "Hanoi", 21.0280, 105.8540, 20.0),
    ("GN-HAN-02", "Cau Giay grid node", "Hanoi", 21.0330, 105.7900, 14.0),
    ("GN-HAN-03", "Long Bien grid node", "Hanoi", 21.0450, 105.8900, 8.5),
    ("GN-HAN-04", "Ha Dong grid node", "Hanoi", 20.9700, 105.7800, 6.0),
    ("GN-DAD-01", "Hai Chau grid node", "Da Nang", 16.0600, 108.2100, 14.0),
    ("GN-DAD-02", "Ngu Hanh Son grid node", "Da Nang", 16.0100, 108.2500, 5.0),
    ("GN-HPH-01", "Le Chan grid node", "Hai Phong", 20.8500, 106.6700, 20.0),
    ("GN-NTR-01", "Nha Trang grid node", "Nha Trang", 12.2550, 109.1800, 18.0),
]


def _km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    dy = (lat2 - lat1) * 111.0
    dx = (lon2 - lon1) * 111.0 * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot(dx, dy)


def status(loading: float) -> str:
    if loading > 1.0:
        return "over_capacity"
    if loading >= CONSTRAINED_AT:
        return "constrained"
    if loading >= WATCH_AT:
        return "watch"
    return "ok"


def station_need(c: dict[str, Any]) -> dict[str, float]:
    installed = c["ports"] * c["power_kw"]
    peak = installed * min(1.0, c["utilization"] * PEAK_COINCIDENCE)
    return {"installed_kw": installed, "peak_need_kw": round(peak, 1), "need_90d_kw": round(peak * (1 + c["forecast_90d_pct"] / 100), 1)}


def grid_view(chargers: list[dict[str, Any]]) -> dict[str, Any]:
    nodes = {n[0]: {"node_id": n[0], "name": n[1], "city": n[2], "latitude": n[3], "longitude": n[4],
                    "capacity_kw": n[5] * 1000, "stations": [], "installed_kw": 0.0, "peak_need_kw": 0.0, "need_90d_kw": 0.0}
             for n in GRID_NODES}
    stations = {}
    for c in chargers:
        same_city = [n for n in nodes.values() if n["city"] == c["city"]] or list(nodes.values())
        node = min(same_city, key=lambda n: _km(c["latitude"], c["longitude"], n["latitude"], n["longitude"]))
        need = station_need(c)
        node["stations"].append(c["station_id"])
        for k in ("installed_kw", "peak_need_kw", "need_90d_kw"):
            node[k] += need[k]
        stations[c["station_id"]] = {"node_id": node["node_id"], **need}
    for n in nodes.values():
        n["loading"] = round(n["peak_need_kw"] / n["capacity_kw"], 3)
        n["loading_90d"] = round(n["need_90d_kw"] / n["capacity_kw"], 3)
        n["headroom_kw"] = round(n["capacity_kw"] - n["peak_need_kw"], 1)
        n["status"] = status(n["loading"])
        n["status_90d"] = status(n["loading_90d"])
        for k in ("installed_kw", "peak_need_kw", "need_90d_kw"):
            n[k] = round(n[k], 1)
    return {
        "note": "SYNTHETIC GRID: invented nodes and capacities, not EVN data. Peak need is an estimate from utilization.",
        "thresholds": {"watch": WATCH_AT, "constrained": CONSTRAINED_AT},
        "nodes": sorted(nodes.values(), key=lambda n: -n["loading"]),
        "stations": stations,
    }
