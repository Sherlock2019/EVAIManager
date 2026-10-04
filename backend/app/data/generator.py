"""Synthetic data generation for both POCs.

Everything here is fabricated from a seeded random generator. No real vehicle,
customer or network data is used.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import numpy as np

from app.data import geo
from app.services import adas_label_engine as label_engine

VN_TZ = timezone(timedelta(hours=7))
WHEELS = ["fl", "fr", "rl", "rr"]

# Scenario quotas for the ADAS frame sample (must not exceed the frame count).
SCENARIO_QUOTAS: dict[str, int] = {
    "motorcycles_heavy_rain": 342,
    "night_pedestrian_crossing": 198,
    "truck_occlusion": 157,
    "tunnel_entry": 86,
    "fog_highway": 120,
    "dusk_bicycle": 95,
    "dense_intersection": 260,
    "rain_urban": 420,
    "night_highway": 380,
}
REVIEW_QUEUE_TARGET = 1284
DEMO_FRAME_ID = "FRM-004242"
DEMO_VEHICLE_ID = "VF-EV-0612"

# Pinned showcase vehicles: id -> (model, issue, severity, target risk of the component)
PINNED_ISSUES: dict[int, tuple[str, str, str]] = {
    821: ("VF 8", "thermal", "critical"),
    442: ("VF 6", "tire", "high"),
    1077: ("VF 9", "motor", "critical"),
    305: ("VF 5", "battery", "high"),
}
ISSUE_TYPES = ["thermal", "tire", "battery", "motor", "brakes", "charging"]
SEVERITY_COUNTS = {"critical": 9, "high": 14, "medium": 43}
SEVERITY_RANGE = {"critical": (1.0, 1.0), "high": (0.74, 0.86), "medium": (0.40, 0.66)}


# ---------------------------------------------------------------------------
# Fleet
# ---------------------------------------------------------------------------

def _place_vehicle(city: str, rng: np.random.Generator) -> tuple[float, float, str]:
    if city == "Ho Chi Minh City":
        names = list(geo.HCMC_ZONES)
        weights = np.array([geo.HCMC_ZONES[n]["demand"] for n in names])
        zone = str(rng.choice(names, p=weights / weights.sum()))
        z = geo.HCMC_ZONES[zone]
        return float(rng.normal(z["lat"], 0.011)), float(rng.normal(z["lon"], 0.011)), zone
    c = geo.CITIES[city]
    zone = str(rng.choice(geo.OTHER_CITY_ZONES[city]))
    return float(rng.normal(c["lat"], c["sigma_lat"])), float(rng.normal(c["lon"], c["sigma_lon"])), zone


def _apply_issue(v: dict[str, Any], issue: str, r: float, rng: np.random.Generator) -> None:
    """Push telemetry so the maintenance engine sees component risk ~= r."""
    if issue == "thermal":
        v["battery_temperature"] = round(37 + 12 * r + (1.5 if r >= 1 else 0), 1)
        v["charging_cycles"] = int(v["charging_cycles"] * (1.3 + 0.25 * r))
        v["average_efficiency"] = round(v["average_efficiency"] * (1.08 + 0.10 * r), 1)
        if r > 0.7:
            v["fault_codes"] = ["BMS-T01"]
    elif issue == "tire":
        wheel = str(rng.choice(WHEELS)) if v["vehicle_id"] != "VF-EV-0442" else "rr"
        v[f"tire_pressure_{wheel}"] = round(2.32 - 0.42 * r, 2)
        if r > 0.7:
            v["fault_codes"] = [f"TPMS-{wheel.upper()}"]
    elif issue == "battery":
        v["battery_soh"] = round(90 - 10 * r - (1.0 if r >= 1 else 0), 1)
        if r > 0.7:
            v["fault_codes"] = ["BMS-C04"]
    elif issue == "motor":
        v["motor_temperature"] = round(78 + 26 * r + (3 if r >= 1 else 0), 1)
        v["average_efficiency"] = round(v["average_efficiency"] * (1.05 + 0.08 * r), 1)
        if r > 0.7:
            v["fault_codes"] = ["MOT-T02"]
    elif issue == "brakes":
        v["km_since_service"] = int(18000 + 14000 * r + (800 if r >= 1 else 0))
        if r > 0.7:
            v["fault_codes"] = ["BRK-W01"]
    elif issue == "charging":
        v["charging_cycles"] = int(v["charging_cycles_expected"] * (1.25 + 0.60 * r + (0.05 if r >= 1 else 0)))
        if r > 0.7:
            v["fault_codes"] = ["CHG-C03"]


def generate_vehicles(n: int, rng: np.random.Generator, now: datetime) -> list[dict[str, Any]]:
    cities = list(geo.CITIES)
    city_p = np.array([geo.CITIES[c]["share"] for c in cities])
    models = list(geo.VEHICLE_MODELS)
    model_p = np.array([geo.VEHICLE_MODELS[m]["share"] for m in models])

    # Decide which vehicles carry an injected issue.
    issues: dict[int, tuple[str, str]] = {num: (iss, sev) for num, (_, iss, sev) in PINNED_ISSUES.items()}
    remaining = dict(SEVERITY_COUNTS)
    for _, sev in issues.values():
        remaining[sev] -= 1
    free = [i for i in rng.permutation(np.arange(1, n + 1)) if int(i) not in issues and int(i) != 612]
    cursor = 0
    for sev, count in remaining.items():
        for _ in range(count):
            issues[int(free[cursor])] = (str(rng.choice(ISSUE_TYPES)), sev)
            cursor += 1
    offline = {int(free[cursor]), int(free[cursor + 1])}

    vehicles: list[dict[str, Any]] = []
    for num in range(1, n + 1):
        vid = f"VF-EV-{num:04d}"
        city = "Ho Chi Minh City" if num in (821, 442, 612) else str(rng.choice(cities, p=city_p))
        lat, lon, zone = _place_vehicle(city, rng)
        if num in (821, 612):
            z = geo.HCMC_ZONES["Thu Duc"]
            lat, lon, zone = z["lat"] + 0.004, z["lon"] - 0.006 * (1 if num == 821 else -1), "Thu Duc"
        model = PINNED_ISSUES[num][0] if num in PINNED_ISSUES else str(rng.choice(models, p=model_p))
        spec = geo.VEHICLE_MODELS[model]
        year = int(rng.choice([2022, 2023, 2024, 2025, 2026], p=[0.08, 0.2, 0.3, 0.3, 0.12]))
        if model == "VF 3":
            year = max(year, 2024)
        age_years = max(0.25, (now.year + now.month / 12) - (year + 0.5))
        odometer = int(age_years * rng.uniform(9000, 22000) + rng.uniform(500, 3000))
        daily_km = float(np.clip(rng.normal(48, 18), 8, 160))
        expected_cycles = odometer / (spec["range_km"] * 0.6)
        cycles = int(expected_cycles * rng.uniform(0.9, 1.15))
        soh = float(np.clip(100 - odometer / 10000 * rng.uniform(0.4, 0.7) - cycles * 0.003, 90.5, 100))
        days_since_service = int(rng.uniform(20, min(330, 12000 / daily_km)))
        v: dict[str, Any] = {
            "vehicle_id": vid,
            "model": model,
            "year": year,
            "city": city,
            "zone": zone,
            "latitude": round(lat, 6),
            "longitude": round(lon, 6),
            "battery_soc": round(float(rng.uniform(18, 96)), 1),
            "battery_soh": round(soh, 1),
            "battery_temperature": round(float(np.clip(rng.normal(33, 2.2), 26, 38.0)), 1),
            "motor_temperature": round(float(np.clip(rng.normal(64, 6), 48, 76)), 1),
            "odometer_km": odometer,
            "daily_km": round(daily_km, 1),
            "charging_cycles": cycles,
            "charging_cycles_expected": int(expected_cycles),
            "average_efficiency": round(spec["wh_km"] * float(rng.uniform(0.95, 1.06)), 1),
            "fault_codes": [],
            "km_since_service": int(days_since_service * daily_km),
            "last_service": (now - timedelta(days=days_since_service)).date().isoformat(),
            "next_service": (now + timedelta(days=int(rng.uniform(25, 200)))).date().isoformat(),
            "speed_kmh": 0.0,
            "status": "healthy",
            "moving": False,
            "route_id": None,
        }
        for w in WHEELS:
            v[f"tire_pressure_{w}"] = round(float(np.clip(rng.normal(2.40, 0.035), 2.33, 2.50)), 2)
        if num in issues:
            issue, sev = issues[num]
            lo, hi = SEVERITY_RANGE[sev]
            _apply_issue(v, issue, float(rng.uniform(lo, hi)), rng)
            if sev == "critical":  # critical cases show a secondary symptom too
                secondary = "charging" if issue != "charging" else "thermal"
                saved_codes = v["fault_codes"]
                _apply_issue(v, secondary, float(rng.uniform(0.25, 0.6)), rng)
                v["fault_codes"] = saved_codes
        if num in offline:
            v["status"] = "offline"
        elif rng.random() < 0.14:
            v["status"] = "charging"
        elif rng.random() < 0.26:
            v["moving"] = True
            v["speed_kmh"] = round(float(rng.uniform(18, 62)), 1)
        vehicles.append(v)

    # Hand-tuned showcase vehicle matching the demo narrative.
    hero = vehicles[820]
    hero.update(battery_temperature=50.6, battery_soc=67.0, battery_soh=92.0, motor_temperature=67.0,
                odometer_km=42842, status="healthy", moving=True, speed_kmh=41.0, fault_codes=["BMS-T01"])
    hero["charging_cycles_expected"] = int(42842 / (geo.VEHICLE_MODELS["VF 8"]["range_km"] * 0.6))
    hero["charging_cycles"] = int(hero["charging_cycles_expected"] * 1.31)
    hero["average_efficiency"] = round(190 * 1.17, 1)
    demo = vehicles[611]
    demo.update(status="healthy", moving=True, speed_kmh=38.0, battery_soc=71.0, battery_temperature=34.2, motor_temperature=63.0)
    return vehicles


# ---------------------------------------------------------------------------
# Charging network
# ---------------------------------------------------------------------------

def _station_status(util: float) -> str:
    if util > 0.85:
        return "overloaded"
    if util >= 0.70:
        return "high"
    if util < 0.30:
        return "low"
    return "normal"


def generate_chargers(rng: np.random.Generator) -> list[dict[str, Any]]:
    stations: list[dict[str, Any]] = []

    def add(name: str, city: str, zone: str, lat: float, lon: float, ports: int, util: float, forecast: float, sessions: int) -> None:
        power = int(rng.choice([60, 120, 150, 250], p=[0.3, 0.35, 0.25, 0.1]))
        start = int(rng.choice([7, 11, 17, 18, 18, 19]))
        stations.append({
            "station_id": f"CS-{len(stations) + 1:03d}",
            "name": name, "city": city, "zone": zone,
            "latitude": round(lat, 6), "longitude": round(lon, 6),
            "ports": ports,
            "available": max(0, int(round(ports * (1 - util)))),
            "utilization": round(util, 2),
            "avg_daily_sessions": sessions,
            "peak_window": f"{start:02d}:00–{start + 3:02d}:00",
            "forecast_90d_pct": round(forecast, 1),
            "power_kw": power,
            "fast": power >= 120,
            "status": _station_status(util),
        })

    for name, zone, lat, lon, ports, util, forecast, sessions in geo.HCMC_STATION_SEEDS:
        add(name, "Ho Chi Minh City", zone, lat, lon, ports, util, forecast, sessions)
    stations[0]["peak_window"] = "18:00–21:00"
    stations[0]["power_kw"], stations[0]["fast"] = 150, True

    suffixes = ["EV Station", "Charging Point", "Fast Charge", "EV Plaza", "Mobility Hub"]
    for city, c in geo.CITIES.items():
        have = sum(1 for s in stations if s["city"] == city)
        zones = list(geo.HCMC_ZONES) if city == "Ho Chi Minh City" else geo.OTHER_CITY_ZONES[city]
        zones = [z for z in zones if z != "District 7 West"]
        for i in range(c["stations"] - have):
            zone = zones[i % len(zones)]
            if city == "Ho Chi Minh City":
                z = geo.HCMC_ZONES[zone]
                lat, lon = rng.normal(z["lat"], 0.012), rng.normal(z["lon"], 0.012)
                growth = z["growth"]
            else:
                lat, lon = rng.normal(c["lat"], c["sigma_lat"] * 1.1), rng.normal(c["lon"], c["sigma_lon"] * 1.1)
                growth = 0.5
            ports = int(rng.choice([4, 6, 8, 10, 12, 16], p=[0.15, 0.25, 0.25, 0.15, 0.12, 0.08]))
            util = float(np.clip(rng.beta(4.2, 3.6), 0.12, 0.80))
            forecast = float(np.clip(rng.normal(6 + 12 * growth, 3), 1, 18))
            sessions = int(ports * util * rng.uniform(9, 12))
            add(f"{zone} {suffixes[i % len(suffixes)]} {i // len(zones) + 1}", city, zone, float(lat), float(lon), ports, util, forecast, sessions)
    return stations


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

def _polyline(points: list[tuple[float, float]], rng: np.random.Generator, per_leg: int = 16, bow_max: float = 0.14) -> list[list[float]]:
    """Interpolate waypoints into a gently curved, road-like polyline."""
    out: list[list[float]] = []
    for (alat, alon), (blat, blon) in zip(points[:-1], points[1:]):
        dlat, dlon = blat - alat, blon - alon
        bow = float(rng.uniform(-bow_max, bow_max))
        wobble = float(rng.uniform(-0.03, 0.03))
        for t in np.linspace(0, 1, per_leg, endpoint=False):
            s = np.sin(np.pi * t) * bow + np.sin(3 * np.pi * t) * wobble
            out.append([round(alat + dlat * t - dlon * s, 6), round(alon + dlon * t + dlat * s, 6)])
    out.append([round(points[-1][0], 6), round(points[-1][1], 6)])
    return out


def _route_length(coords: list[list[float]]) -> float:
    return sum(geo.haversine_km(a[0], a[1], b[0], b[1]) for a, b in zip(coords[:-1], coords[1:]))


def generate_routes(rng: np.random.Generator) -> list[dict[str, Any]]:
    routes: list[dict[str, Any]] = []

    def add(name: str, city: str, kind: str, stops: list[str], pts: list[tuple[float, float]], trips: int, **kw: Any) -> None:
        coords = _polyline(pts, rng, **kw)
        routes.append({
            "route_id": f"RT-{len(routes) + 1:03d}", "name": name, "city": city, "kind": kind,
            "stops": stops, "coords": coords,
            "distance_km": round(_route_length(coords) * 1.18, 1),  # road-factor over straight segments
            "trips_per_day": trips,
        })

    for stops, trips in geo.HCMC_ROUTES:
        pts = [(geo.HCMC_ZONES[s]["lat"], geo.HCMC_ZONES[s]["lon"]) for s in stops]
        add(" → ".join(stops), "Ho Chi Minh City", "urban", stops, pts, trips)

    for city, zones in geo.OTHER_CITY_ZONES.items():
        c = geo.CITIES[city]
        for i in range(5 if city == "Hanoi" else 3):
            stops = [str(z) for z in rng.choice(zones, size=3, replace=False)]
            pts = [(float(rng.normal(c["lat"], c["sigma_lat"])), float(rng.normal(c["lon"], c["sigma_lon"]))) for _ in stops]
            pts[1] = (c["lat"], c["lon"])
            add(" → ".join(stops), city, "urban", stops, pts, int(rng.uniform(220, 640)))

    for name, pts, trips in geo.CORRIDORS:
        add(name, "Intercity", "corridor", name.replace(" Expressway", "").replace(" Coastal", "").replace(" North-South", "").split(" - "), pts, trips, per_leg=22, bow_max=0.05)
    return routes


def assign_routes(vehicles: list[dict[str, Any]], routes: list[dict[str, Any]], rng: np.random.Generator) -> None:
    """Put a subset of the fleet on named routes so the map shows purposeful traffic."""
    by_city: dict[str, list[dict[str, Any]]] = {}
    for v in vehicles:
        if v["status"] == "healthy" and v["vehicle_id"] not in ("VF-EV-0821", "VF-EV-0612"):
            by_city.setdefault(v["city"], []).append(v)
    pinned = {"VF-EV-0821": 0, "VF-EV-0612": 2}  # D1→Thu Duc→Di An, D1→Binh Thanh→Thu Duc
    index = {v["vehicle_id"]: v for v in vehicles}
    for vid, ridx in pinned.items():
        _put_on_route(index[vid], routes[ridx], rng)
    for route in routes:
        if route["kind"] == "corridor":
            # corridor traffic is drawn from the city at the start of the corridor
            start = route["coords"][0]
            city = min(geo.CITIES, key=lambda c: geo.haversine_km(start[0], start[1], geo.CITIES[c]["lat"], geo.CITIES[c]["lon"]))
            count = 7
        else:
            city, count = route["city"], 3
        pool = by_city.get(city, [])
        for _ in range(count):
            if pool:
                _put_on_route(pool.pop(int(rng.integers(len(pool)))), route, rng)


def _put_on_route(v: dict[str, Any], route: dict[str, Any], rng: np.random.Generator) -> None:
    coords = route["coords"]
    i = int(rng.integers(0, len(coords) - 1))
    v.update(route_id=route["route_id"], moving=True, latitude=coords[i][0], longitude=coords[i][1],
             speed_kmh=round(float(rng.uniform(70, 95) if route["kind"] == "corridor" else rng.uniform(24, 52)), 1))
    v["route_progress"] = i / (len(coords) - 1)
    v["route_direction"] = 1 if rng.random() < 0.5 else -1


# ---------------------------------------------------------------------------
# ADAS frames
# ---------------------------------------------------------------------------

SPEED_BY_ROAD = {"urban": (18, 48), "highway": (70, 110), "residential": (10, 32), "intersection": (0, 28), "tunnel": (40, 70)}


def generate_frames(n: int, vehicles: list[dict[str, Any]], rng: np.random.Generator, now: datetime) -> list[dict[str, Any]]:
    scenarios: list[str] = []
    for name, quota in SCENARIO_QUOTAS.items():
        scenarios += [name] * quota
    scenarios += ["nominal"] * max(0, n - len(scenarios))
    scenarios = [str(s) for s in rng.permutation(scenarios[:n])]

    online = [v for v in vehicles if v["status"] != "offline"]
    hcmc = [v for v in online if v["city"] == "Ho Chi Minh City"]
    frames: list[dict[str, Any]] = []
    for i, scenario in enumerate(scenarios):
        frame_id = f"FRM-{i + 1:06d}"
        # Motorcycle-dense scenarios are mostly observed in HCMC traffic.
        pool = hcmc if scenario in ("motorcycles_heavy_rain", "dense_intersection") and rng.random() < 0.75 else online
        v = pool[int(rng.integers(len(pool)))]
        ctx = label_engine.sample_context(scenario, rng)
        objects = label_engine.generate_detections(scenario, ctx, rng)
        lo, hi = SPEED_BY_ROAD[ctx.road_type]
        frames.append({
            "frame_id": frame_id,
            "vehicle_id": v["vehicle_id"],
            "city": v["city"],
            "timestamp": (now - timedelta(seconds=float(rng.uniform(0, 86400)))).isoformat(timespec="seconds"),
            "latitude": round(v["latitude"] + float(rng.normal(0, 0.004)), 6),
            "longitude": round(v["longitude"] + float(rng.normal(0, 0.004)), 6),
            "speed_kmh": round(float(rng.uniform(lo, hi)), 1),
            "weather": ctx.weather,
            "lighting": ctx.lighting,
            "road_type": ctx.road_type,
            "camera_front_path": f"synthetic://camera/front/{frame_id}.svg",
            "lidar_available": bool(rng.random() < 0.82),
            "objects": objects,
            "objects_detected": len(objects),
            "model_confidence": label_engine.frame_confidence(objects),
            "label_status": "",
            "review_required": False,
            "dataset_version": "ADAS-v23",
            "scenario_category": scenario,
        })

    _pin_demo_frame(frames, rng)
    _route_frames(frames, rng)
    return frames


def _pin_demo_frame(frames: list[dict[str, Any]], rng: np.random.Generator) -> None:
    """A fixed low-confidence motorcycle frame used by the guided demo."""
    idx = int(DEMO_FRAME_ID.split("-")[1]) - 1
    if idx >= len(frames):
        return
    f = frames[idx]
    ctx = label_engine.SceneContext("heavy_rain", "dusk", "urban")
    objects = [
        {"id": 1, "cls": "car", "confidence": 0.94, "bbox": [0.12, 0.60, 0.25, 0.18], "occluded": False, "small": False, "factors": ["dusk", "heavy_rain"], "source": "ai"},
        {"id": 2, "cls": "car", "confidence": 0.91, "bbox": [0.62, 0.58, 0.24, 0.17], "occluded": False, "small": False, "factors": ["dusk", "heavy_rain"], "source": "ai"},
        {"id": 3, "cls": "motorcycle", "confidence": 0.58, "bbox": [0.44, 0.55, 0.075, 0.12], "occluded": True, "small": False,
         "factors": ["dusk", "heavy_rain", "occlusion", "motorcycle between cars"], "source": "ai"},
        {"id": 4, "cls": "pedestrian", "confidence": 0.71, "bbox": [0.88, 0.50, 0.035, 0.085], "occluded": False, "small": True, "factors": ["dusk", "heavy_rain", "small object"], "source": "ai"},
    ]
    f.update(weather=ctx.weather, lighting=ctx.lighting, road_type=ctx.road_type, city="Ho Chi Minh City",
             vehicle_id=DEMO_VEHICLE_ID, latitude=10.8412, longitude=106.7498, speed_kmh=31.0,
             scenario_category="motorcycles_heavy_rain", objects=objects, objects_detected=4, model_confidence=0.58)


def _route_frames(frames: list[dict[str, Any]], rng: np.random.Generator) -> None:
    """Apply the confidence routing policy and build the human review queue."""
    medium: list[dict[str, Any]] = []
    mandatory = 0
    for f in frames:
        decision = label_engine.route_frame(f["model_confidence"])
        if decision == "auto_accept":
            f["label_status"] = "auto_accepted"
        elif decision == "sample_review":
            f["label_status"] = "sample_passed"
            medium.append(f)
        else:
            f["label_status"], f["review_required"], f["dataset_version"] = "pending_review", True, None
            mandatory += 1
    # Quality-control sample from the medium band, weakest labels first.
    sample_size = max(0, min(len(medium), REVIEW_QUEUE_TARGET - mandatory))
    weights = np.array([(0.9 - f["model_confidence"]) + 0.02 for f in medium])
    if sample_size:
        picked = rng.choice(len(medium), size=sample_size, replace=False, p=weights / weights.sum())
        for j in picked:
            medium[int(j)].update(label_status="pending_review", review_required=True, dataset_version=None)


# ---------------------------------------------------------------------------
# Dataset versions
# ---------------------------------------------------------------------------

def generate_datasets(frames: list[dict[str, Any]]) -> list[dict[str, Any]]:
    def dist(keys: list[str], values: list[float]) -> dict[str, float]:
        return dict(zip(keys, values))

    classes = label_engine.OBJECT_CLASSES
    weather = label_engine.WEATHER
    cities = list(geo.CITIES)
    return [
        {"version": "ADAS-v21", "frames_total": 1_700_000, "frames_added": 210_000, "status": "Production", "created": "2026-03-14",
         "human_corrections": 38_400, "edge_cases_added": 9_200, "model": "ADAS Vision v5",
         "class_distribution": dist(classes, [41, 8, 4, 22, 5, 11, 4, 5]),
         "weather_distribution": dist(weather, [74, 16, 4, 6]),
         "city_distribution": dist(cities, [44, 30, 10, 9, 7])},
        {"version": "ADAS-v22", "frames_total": 1_900_000, "frames_added": 200_000, "status": "Archived", "created": "2026-05-22",
         "human_corrections": 41_900, "edge_cases_added": 12_600, "model": "—",
         "class_distribution": dist(classes, [40, 8, 4, 23, 5, 11, 4, 5]),
         "weather_distribution": dist(weather, [71, 17, 5, 7]),
         "city_distribution": dist(cities, [45, 29, 10, 9, 7])},
        {"version": "ADAS-v23", "frames_total": 2_100_000, "frames_added": 200_000, "status": "Current", "created": "2026-08-09",
         "human_corrections": 47_300, "edge_cases_added": 18_900, "model": "ADAS Vision v6",
         "class_distribution": dist(classes, [38, 8, 4, 25, 5, 12, 4, 4]),
         "weather_distribution": dist(weather, [66, 19, 7, 8]),
         "city_distribution": dist(cities, [46, 28, 10, 9, 7])},
        {"version": "ADAS-v24", "frames_total": 2_243_000, "frames_added": 143_000, "status": "Building", "created": "2026-10-01",
         "human_corrections": 12_840, "edge_cases_added": 6_420, "model": "ADAS Vision v7 (planned)",
         "class_distribution": dist(classes, [34, 7, 4, 29, 6, 13, 4, 3]),
         "weather_distribution": dist(weather, [55, 21, 13, 11]),
         "city_distribution": dist(cities, [48, 27, 10, 8, 7])},
    ]


def generate_all(seed: int, fleet_size: int, frame_count: int) -> dict[str, Any]:
    rng = np.random.default_rng(seed)
    now = datetime.now(VN_TZ)
    vehicles = generate_vehicles(fleet_size, rng, now)
    chargers = generate_chargers(rng)
    routes = generate_routes(rng)
    assign_routes(vehicles, routes, rng)
    frames = generate_frames(frame_count, vehicles, rng, now)
    return {
        "vehicles": vehicles,
        "chargers": chargers,
        "routes": routes,
        "frames": frames,
        "datasets": generate_datasets(frames),
        "candidate_sites": [dict(c) for c in geo.CANDIDATE_SITES],
        "planned_sites": [dict(p) for p in geo.PLANNED_SITES],
    }
