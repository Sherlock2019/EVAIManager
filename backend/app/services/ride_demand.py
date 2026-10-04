"""Ride demand intelligence: where passengers are, where the EVs are, hour by hour.

The IoT inputs a real deployment would use (seat-occupancy and door sensors,
GPS, in-app ride requests, charger session logs) are simulated. The 24-hour
forecast is a transparent zone model, not a trained network:

    pickups(zone, h)  = daily_rides(zone) * pickup_profile(zone type, h)
    flow(a -> b, h)   = pickups(a, h) * attraction(b, h) * exp(-distance / 6 km)
    evs(zone, h)      = on_duty(h) * (0.65 * last hour's drop-offs + 0.35 * home zone)
    shortfall(zone,h) = pickups - evs * RIDES_PER_EV_HOUR

Chargers are then right-sized against the peak hour of the load those EVs create.
"""
from __future__ import annotations

import math
from typing import Any, Literal

import numpy as np

from app.data import geo
from app.data.repository import Repository

CITY = "Ho Chi Minh City"
DayType = Literal["weekday", "weekend"]

RIDES_PER_EV_DAY = 20           # ride-hail trips one EV completes per day
RIDES_PER_EV_HOUR = 1.8         # trips one on-duty EV can serve per hour
WEEKEND_VOLUME = 0.9
DECAY_KM = 6.0                  # trip-length decay of the gravity model
ROAD_FACTOR = 1.3               # straight-line to road distance
CITY_SPEED_KMH = 24.0
FOLLOW_DROPOFFS = 0.65          # share of on-duty EVs idling where they last dropped off
SHORTAGE_BELOW = 0.85           # EV capacity / pickups
SURPLUS_ABOVE = 1.5
REPOSITION_BUFFER = 1.15        # a zone keeps this much of its own next-hour need
MIN_MOVE_EVS = 3
MAX_MOVE_MIN = 40               # do not send an EV further than this
TARGET_PEAK_UTILIZATION = 0.90  # stations are sized so the busiest hour sits here
PEAK_TO_AVERAGE = (1.15, 1.5)   # bounds on a zone's busiest charging hour versus its daily mean
OVERSIZED_BELOW = 0.60          # required / installed ports
SITE_MIN_SHORTFALL = 6          # zone port shortfall that justifies a new site
SITE_ABSORB = 0.5               # share of the shortfall a new site takes
CLOUD_POINTS = 36

HOURS = np.arange(24)

ARCHETYPE: dict[str, str] = {
    "District 1": "cbd", "Thu Duc": "tech", "Tan Binh": "airport", "District 7": "leisure",
    "Binh Thanh": "residential", "Phu Nhuan": "residential", "Go Vap": "residential", "Thao Dien": "leisure",
    "Binh Tan": "residential", "District 12": "residential", "Tan Phu": "residential", "Nha Be": "residential",
    "Di An": "tech", "District 7 West": "residential",
}
ARCHETYPE_LABEL = {"cbd": "Business district", "residential": "Residential", "airport": "Airport",
                   "tech": "Tech & industrial park", "leisure": "Dining & leisure"}

# (base level, [(peak hour, width in hours, height)])
Profile = tuple[float, list[tuple[float, float, float]]]
PICKUP_PROFILE: dict[str, Profile] = {
    "cbd": (0.25, [(12.0, 1.2, 0.5), (17.5, 1.6, 1.0), (22.0, 1.5, 0.55)]),
    "residential": (0.15, [(7.5, 1.3, 1.0), (13.0, 2.0, 0.25), (19.0, 2.0, 0.3)]),
    "airport": (0.35, [(6.0, 1.5, 0.6), (14.0, 2.0, 0.7), (22.0, 1.8, 0.9)]),
    "tech": (0.12, [(7.0, 1.5, 0.25), (12.0, 1.0, 0.3), (17.5, 1.3, 1.0)]),
    "leisure": (0.18, [(8.0, 1.5, 0.5), (13.0, 1.5, 0.35), (21.5, 1.8, 1.0)]),
}
DROPOFF_PROFILE: dict[str, Profile] = {
    "cbd": (0.20, [(8.3, 1.3, 1.0), (13.0, 1.5, 0.4), (20.0, 1.5, 0.5)]),
    "residential": (0.15, [(12.5, 1.5, 0.2), (18.5, 1.5, 1.0), (23.0, 1.5, 0.4)]),
    "airport": (0.30, [(5.0, 1.5, 0.7), (12.0, 2.0, 0.6), (19.0, 2.0, 0.7)]),
    "tech": (0.10, [(8.0, 1.3, 1.0), (13.0, 1.0, 0.25)]),
    "leisure": (0.15, [(9.0, 1.5, 0.3), (12.0, 1.5, 0.4), (19.5, 1.5, 1.0)]),
}

SIGNALS = [
    {"source": "Seat occupancy + door sensors", "use": "Passenger on board, pickup and drop-off events"},
    {"source": "GPS / telematics", "use": "Where each EV is and which zones it idles in"},
    {"source": "In-app ride requests", "use": "Demand that was requested, including rides nobody served"},
    {"source": "Charger session logs", "use": "Ports busy per hour at every station"},
]


def _circular(mu: float) -> np.ndarray:
    d = np.abs(HOURS - mu)
    return np.minimum(d, 24 - d)


def _profile(spec: Profile, archetype: str, day: DayType) -> np.ndarray:
    base, bumps = spec
    out = np.full(24, base)
    for mu, sigma, amp in bumps:
        if day == "weekend":
            # commuter peaks shrink, midday and evening leisure trips grow; flights do not care
            if archetype != "airport":
                amp *= 0.4 if (mu < 10 or 16 <= mu < 19.5) else 1.3
        out = out + amp * np.exp(-0.5 * (_circular(mu) / sigma) ** 2)
    return out


def _even_up(x: float) -> int:
    return 2 * math.ceil(x / 2)


def _hh(h: int) -> str:
    return f"{h % 24:02d}:00"


def _status(ratio: float) -> str:
    return "SHORTAGE" if ratio < SHORTAGE_BELOW else "SURPLUS" if ratio > SURPLUS_ABOVE else "BALANCED"


def forecast(repo: Repository, day: DayType = "weekday") -> dict[str, Any]:
    """The full 24-hour picture for one day type; the dashboard scrubs through it client-side."""
    names = list(geo.HCMC_ZONES)
    index = {n: i for i, n in enumerate(names)}
    zones = [geo.HCMC_ZONES[n] for n in names]
    types = [ARCHETYPE[n] for n in names]
    n_zones = len(names)
    demand = np.array([z["demand"] for z in zones])

    fleet = [v for v in repo.vehicles if v["city"] == CITY]
    n_evs = max(1, len(fleet))
    home = np.array([sum(1 for v in fleet if v["zone"] == n) for n in names], dtype=float)
    home = home / home.sum() if home.sum() else demand / demand.sum()

    dist = np.array([[1.5 if a == b else ROAD_FACTOR * geo.haversine_km(za["lat"], za["lon"], zb["lat"], zb["lon"])
                      for b, zb in enumerate(zones)] for a, za in enumerate(zones)])

    # -- passengers: pickups[zone, hour] ----------------------------------
    asleep = 1 - 0.82 * np.exp(-0.5 * (_circular(3.0) / 1.8) ** 2)
    daily = demand / demand.sum() * n_evs * RIDES_PER_EV_DAY * (WEEKEND_VOLUME if day == "weekend" else 1.0)
    shape = np.array([_profile(PICKUP_PROFILE[t], t, day) * asleep for t in types])
    pickups = daily[:, None] * shape / shape.sum(axis=1, keepdims=True)

    # -- origin -> destination: flows[hour, from, to] ----------------------
    attraction = demand[:, None] * np.array([_profile(DROPOFF_PROFILE[t], t, day) for t in types])
    weight = attraction.T[:, None, :] * np.exp(-dist / DECAY_KM)[None, :, :]
    flows = pickups.T[:, :, None] * weight / weight.sum(axis=2, keepdims=True)
    dropoffs = flows.sum(axis=1).T

    # -- EV supply: evs[zone, hour] ----------------------------------------
    total = pickups.sum(axis=0)
    smoothed = (np.roll(total, 1) + total + np.roll(total, -1)) / 3
    duty = 0.26 + 0.70 * smoothed / smoothed.max()
    last_drop = np.roll(dropoffs, 1, axis=1)
    share = FOLLOW_DROPOFFS * last_drop / last_drop.sum(axis=0) + (1 - FOLLOW_DROPOFFS) * home[:, None]
    evs = n_evs * duty[None, :] * share
    capacity = evs * RIDES_PER_EV_HOUR
    ratio = capacity / np.maximum(pickups, 1e-6)
    unserved = np.maximum(0.0, pickups - capacity)

    off_diagonal = ~np.eye(n_zones, dtype=bool)

    def top_flows(matrix: np.ndarray, limit: int) -> list[tuple[int, int]]:
        order = np.argsort(np.where(off_diagonal, matrix, 0.0), axis=None)[::-1][:limit]
        return [(int(i), int(j)) for i, j in zip(*np.unravel_index(order, matrix.shape))]

    def moves(h: int) -> list[dict[str, Any]]:
        """Reposition idle EVs now so they are in place for the next hour's pickups."""
        nxt = (h + 1) % 24
        want = pickups[:, nxt] / RIDES_PER_EV_HOUR
        short = want - evs[:, h]
        spare = evs[:, h] - want * REPOSITION_BUFFER
        out: list[dict[str, Any]] = []
        for b in np.argsort(short)[::-1]:
            for a in np.argsort(dist[:, b]):
                n = int(min(short[b], spare[a]))
                eta = dist[a, b] / CITY_SPEED_KMH * 60
                if a == b or n < MIN_MOVE_EVS or eta > MAX_MOVE_MIN:
                    continue
                short[b] -= n
                spare[a] -= n
                out.append({
                    "from": int(a), "to": int(b), "evs": n,
                    "distance_km": round(float(dist[a, b]), 1), "eta_min": int(round(eta)),
                    "depart_by": f"{h:02d}:{max(0, 60 - int(math.ceil(eta / 5) * 5)):02d}",
                    "arrive_for": _hh(nxt),
                    "extra_rides": int(round(n * RIDES_PER_EV_HOUR)),
                    "reason": f"{names[b]} needs {want[b]:.0f} EVs at {_hh(nxt)}, {evs[b, h]:.0f} are there now",
                })
        return sorted(out, key=lambda m: m["evs"], reverse=True)[:6]

    hours = []
    for h in range(24):
        hours.append({
            "hour": h, "label": _hh(h),
            "passengers": int(round(total[h])),
            "evs_on_duty": int(round(n_evs * duty[h])),
            "capacity": int(round(capacity[:, h].sum())),
            "unserved": int(round(unserved[:, h].sum())),
            "idle_evs": int(round(np.maximum(0.0, evs[:, h] - pickups[:, h] / RIDES_PER_EV_HOUR).sum())),
            "zones": [{
                "pickups": int(round(pickups[z, h])), "dropoffs": int(round(dropoffs[z, h])),
                "evs": int(round(evs[z, h])), "ratio": round(float(min(9.9, ratio[z, h])), 2),
                "status": _status(ratio[z, h]),
                "wait_min": round(float(np.clip(3.5 / ratio[z, h], 1.5, 15.0)), 1),
            } for z in range(n_zones)],
            "flows": [{"from": i, "to": j, "rides": int(round(flows[h, i, j]))} for i, j in top_flows(flows[h], 10) if flows[h, i, j] >= 1],
            "moves": moves(h),
        })

    # -- corridors over the whole day --------------------------------------
    day_flows = flows.sum(axis=0)
    corridors = [{
        "from": i, "to": j, "rides": int(round(day_flows[i, j])),
        "peak_hour": int(np.argmax(flows[:, i, j])), "distance_km": round(float(dist[i, j]), 1),
    } for i, j in top_flows(day_flows, 8)]

    # -- driver shift plan: many ride requests and few EVs to share them with
    per_ev = pickups / np.maximum(evs, 1.0)
    shifts: list[dict[str, Any]] = []
    best = -1
    for h in range(24):
        scores = per_ev[:, h] * np.sqrt(pickups[:, h] / pickups[:, h].max())
        top = int(np.argmax(scores))
        if best < 0 or scores[best] < 0.85 * scores[top]:
            best = top  # switch zones only when the gain is worth the drive
        if shifts and shifts[-1]["zone"] == best:
            block = shifts[-1]
            block["end"] = h + 1
            block["pickups"] += pickups[best, h]
            block["evs"] += evs[best, h]
        else:
            shifts.append({"zone": best, "start": h, "end": h + 1, "pickups": pickups[best, h], "evs": evs[best, h]})
    for block in shifts:
        span = block["end"] - block["start"]
        dest = int(np.argmax(np.where(np.arange(n_zones) == block["zone"], 0.0, flows[block["start"]:block["end"], block["zone"], :].sum(axis=0))))
        block.update({
            "label": f"{_hh(block['start'])}–{_hh(block['end'])}",
            "zone_name": names[block["zone"]],
            "kind": ARCHETYPE_LABEL[types[block["zone"]]],
            "requests_per_ev": round(float(block["pickups"] / max(block["evs"], 1.0)), 1),
            "pickups": int(round(block["pickups"] / span)),
            "evs": int(round(block["evs"] / span)),
            "top_destination": names[dest],
        })

    # -- charger right-sizing ----------------------------------------------
    # EVs charge where they wait and when they are idle; off-duty EVs top up near home.
    idle = np.clip(1 - pickups / np.maximum(capacity, 1e-6), 0.0, 1.0)
    load_shape = evs * (0.2 + idle) + 0.15 * n_evs * home[:, None] * (1 - duty[None, :])
    load_shape = load_shape / load_shape.mean(axis=1, keepdims=True)
    peak_ratio = load_shape.max(axis=1, keepdims=True)
    load_shape = 1 + (load_shape - 1) * (np.clip(peak_ratio, *PEAK_TO_AVERAGE) - 1) / (peak_ratio - 1)

    stations = []
    for c in repo.chargers:
        if c["city"] != CITY or c["zone"] not in index:
            continue
        z = index[c["zone"]]
        busy_ports = c["ports"] * c["utilization"] * load_shape[z]
        peak = int(np.argmax(busy_ports))
        required = max(2, math.ceil(busy_ports[peak] / TARGET_PEAK_UTILIZATION))
        delta = required - c["ports"]
        if delta >= 2:
            verdict, change = "UNDERSIZED", _even_up(delta)
        elif required <= c["ports"] * OVERSIZED_BELOW and -delta >= 4:
            verdict, change = "OVERSIZED", -2 * (-delta // 2)
        else:
            verdict, change = "RIGHT-SIZED", 0
        stations.append({
            "station_id": c["station_id"], "name": c["name"], "zone": c["zone"],
            "latitude": c["latitude"], "longitude": c["longitude"],
            "ports": c["ports"], "utilization": c["utilization"], "power_kw": c["power_kw"],
            "peak_hour": peak, "peak_busy_ports": round(float(busy_ports[peak]), 1),
            "required_ports": required, "change_ports": change, "verdict": verdict,
            "queue_at_peak": max(0, int(math.ceil(busy_ports[peak] - c["ports"]))),
            "hourly_busy_ports": [round(float(x), 1) for x in busy_ports],
        })
    stations.sort(key=lambda s: s["change_ports"], reverse=True)

    zone_capacity = []
    for z, name in enumerate(names):
        here = [s for s in stations if s["zone"] == name]
        zone_capacity.append({
            "zone": z, "stations": len(here), "ports": sum(s["ports"] for s in here),
            "required_ports": sum(s["required_ports"] for s in here),
            "shortfall_ports": sum(s["change_ports"] for s in here if s["change_ports"] > 0),
            "surplus_ports": -sum(s["change_ports"] for s in here if s["change_ports"] < 0),
            "peak_hour": int(np.argmax(load_shape[z])),
        })

    proposed, covered = [], set()
    for site in repo.candidate_sites:
        if site["city"] != CITY:
            continue
        z = int(np.argmin([geo.haversine_km(site["lat"], site["lon"], zn["lat"], zn["lon"]) for zn in zones]))
        shortfall = zone_capacity[z]["shortfall_ports"]
        if z in covered or shortfall < SITE_MIN_SHORTFALL:
            continue
        covered.add(z)
        ports = int(min(16, max(4, _even_up(shortfall * SITE_ABSORB))))
        proposed.append({
            "name": site["name"], "zone": z, "latitude": site["lat"], "longitude": site["lon"],
            "ports": ports, "zone_shortfall_ports": shortfall, "peak_hour": zone_capacity[z]["peak_hour"],
            "reason": f"{names[z]} stations run {shortfall} ports short at the {_hh(zone_capacity[z]['peak_hour'])} charging peak",
        })

    # -- static zone info and headline numbers -----------------------------
    rng = np.random.default_rng(23)
    zone_rows = [{
        "name": name, "lat": zones[z]["lat"], "lon": zones[z]["lon"],
        "kind": ARCHETYPE_LABEL[types[z]],
        "daily_pickups": int(round(pickups[z].sum())), "daily_dropoffs": int(round(dropoffs[z].sum())),
        "peak_pickup_hour": int(np.argmax(pickups[z])), "home_evs": int(round(home[z] * n_evs)),
        # fixed scatter the map reuses every hour, so the heat only changes in strength
        "cloud": np.round(rng.normal([zones[z]["lat"], zones[z]["lon"]], 0.0085, (CLOUD_POINTS, 2)), 5).tolist(),
        "ev_cloud": np.round(rng.normal([zones[z]["lat"], zones[z]["lon"]], 0.011, (CLOUD_POINTS, 2)), 5).tolist(),
    } for z, name in enumerate(names)]

    peak_hour = int(np.argmax(total))
    worst_z, worst_h = np.unravel_index(int(np.argmax(unserved)), unserved.shape)
    undersized = [s for s in stations if s["verdict"] == "UNDERSIZED"]
    oversized = [s for s in stations if s["verdict"] == "OVERSIZED"]
    return {
        "city": CITY, "day": day,
        "note": "Synthetic forecast from simulated IoT signals. Zone model, not a trained network.",
        "signals": SIGNALS,
        "zones": zone_rows,
        "hours": hours,
        "corridors": corridors,
        "shifts": shifts,
        "stations": stations,
        "zone_capacity": zone_capacity,
        "proposed_sites": proposed,
        "summary": {
            "evs": n_evs,
            "daily_rides": int(round(total.sum())),
            "peak_hour": peak_hour, "peak_passengers": int(round(total[peak_hour])),
            "peak_evs_on_duty": int(round(n_evs * duty.max())),
            "busiest_pickup_zone": names[int(np.argmax(pickups.sum(axis=1)))],
            "busiest_dropoff_zone": names[int(np.argmax(dropoffs.sum(axis=1)))],
            "unserved_rides": int(round(unserved.sum())),
            "served_pct": round(100 * (1 - float(unserved.sum() / total.sum())), 1),
            "worst_gap": {"zone": names[int(worst_z)], "hour": int(worst_h), "unserved": int(round(unserved[worst_z, worst_h]))},
            "max_zone_pickups": int(math.ceil(pickups.max())), "max_zone_evs": int(math.ceil(evs.max())),
            "stations": len(stations),
            "undersized_stations": len(undersized), "oversized_stations": len(oversized),
            "right_sized_stations": len(stations) - len(undersized) - len(oversized),
            "ports_to_add": sum(s["change_ports"] for s in undersized),
            "ports_to_remove": -sum(s["change_ports"] for s in oversized),
            "proposed_sites": len(proposed),
        },
    }
