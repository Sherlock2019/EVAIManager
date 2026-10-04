"""Simulated ADAS auto-label engine.

This is NOT a perception model. It reproduces the *behaviour* of one for demo
purposes: detections receive a confidence that drops in difficult conditions
(night, rain, fog, occlusion, small objects, vulnerable road users close to
traffic), and each frame is routed by confidence:

    >= 0.90          AUTO ACCEPT
    0.70 - 0.89      SAMPLE REVIEW
    <  0.70          MANDATORY HUMAN REVIEW
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

OBJECT_CLASSES = ["car", "truck", "bus", "motorcycle", "bicycle", "pedestrian", "traffic_light", "traffic_sign"]
WEATHER = ["clear", "rain", "heavy_rain", "fog"]
LIGHTING = ["day", "night", "dawn", "dusk"]
ROAD_TYPES = ["urban", "highway", "residential", "intersection", "tunnel"]

AUTO_ACCEPT_THRESHOLD = 0.90
HUMAN_REVIEW_THRESHOLD = 0.70

BASE_CONFIDENCE: dict[str, float] = {
    "car": 0.97, "truck": 0.96, "bus": 0.96, "motorcycle": 0.93, "bicycle": 0.92,
    "pedestrian": 0.93, "traffic_light": 0.95, "traffic_sign": 0.96,
}
LIGHTING_PENALTY = {"day": 0.0, "dawn": 0.03, "dusk": 0.04, "night": 0.10}
WEATHER_PENALTY = {"clear": 0.0, "rain": 0.05, "heavy_rain": 0.14, "fog": 0.11}
TUNNEL_PENALTY = 0.29          # abrupt exposure change at tunnel entry/exit
OCCLUSION_PENALTY = 0.21
SMALL_OBJECT_PENALTY = 0.05
NEAR_ROAD_PENALTY = 0.10       # pedestrian close to the driving lane
BETWEEN_CARS_PENALTY = 0.10    # motorcycle filtering between cars
# Vulnerable road users are harder to see in bad conditions than large vehicles.
VRU = {"motorcycle", "bicycle", "pedestrian"}
VRU_SENSITIVITY = 1.15
VEHICLE_SENSITIVITY = 0.80


@dataclass(frozen=True)
class SceneContext:
    weather: str
    lighting: str
    road_type: str


def score_detection(
    cls: str,
    ctx: SceneContext,
    rng: np.random.Generator,
    *,
    occluded: bool = False,
    small: bool = False,
    near_road: bool = False,
    between_cars: bool = False,
) -> tuple[float, list[str]]:
    """Return (confidence, difficulty factors) for one simulated detection."""
    sensitivity = VRU_SENSITIVITY if cls in VRU else VEHICLE_SENSITIVITY
    env = LIGHTING_PENALTY[ctx.lighting] + WEATHER_PENALTY[ctx.weather]
    if ctx.road_type == "tunnel":
        env += TUNNEL_PENALTY
    penalty = env * sensitivity
    factors: list[str] = []
    if ctx.lighting != "day":
        factors.append(ctx.lighting)
    if ctx.weather != "clear":
        factors.append(ctx.weather)
    if ctx.road_type == "tunnel":
        factors.append("tunnel lighting transition")
    if occluded:
        penalty += OCCLUSION_PENALTY
        factors.append("occlusion")
    if small:
        penalty += SMALL_OBJECT_PENALTY
        factors.append("small object")
    if near_road and cls == "pedestrian":
        penalty += NEAR_ROAD_PENALTY
        factors.append("pedestrian near road")
    if between_cars and cls == "motorcycle":
        penalty += BETWEEN_CARS_PENALTY
        factors.append("motorcycle between cars")
    conf = BASE_CONFIDENCE[cls] - penalty + float(rng.normal(0, 0.02))
    return round(float(np.clip(conf, 0.31, 0.99)), 3), factors


def frame_confidence(objects: list[dict[str, Any]]) -> float:
    """A frame is only as trustworthy as its weakest label."""
    if not objects:
        return 0.99
    return round(min(o["confidence"] for o in objects), 3)


def route_frame(confidence: float) -> str:
    if confidence >= AUTO_ACCEPT_THRESHOLD:
        return "auto_accept"
    if confidence >= HUMAN_REVIEW_THRESHOLD:
        return "sample_review"
    return "human_review"


# ---------------------------------------------------------------------------
# Synthetic scene layout: where a detection sits in the (normalised) camera view
# ---------------------------------------------------------------------------

def _bbox(cls: str, depth: float, rng: np.random.Generator, *, lane: float = 0.0, crossing: bool = False) -> list[float]:
    """Perspective-ish box [x, y, w, h] in 0-1 image coordinates.

    depth 0 = far (near the horizon), 1 = close to the ego vehicle.
    """
    bottom = 0.44 + 0.50 * depth
    if cls in ("car", "truck", "bus"):
        w = (0.06 + 0.22 * depth) * (1.25 if cls != "car" else 1.0)
        h = w * {"car": 0.72, "truck": 1.10, "bus": 1.00}[cls]
        cx = 0.5 + lane * (0.05 + 0.30 * depth)
    elif cls in ("motorcycle", "bicycle"):
        w = 0.022 + 0.08 * depth
        h = w * 1.55
        cx = 0.5 + lane * (0.05 + 0.30 * depth)
    elif cls == "pedestrian":
        w = 0.016 + 0.06 * depth
        h = w * 2.4
        side = 1 if rng.random() < 0.5 else -1
        cx = 0.5 + (rng.uniform(-0.16, 0.16) if crossing else side * (0.10 + 0.36 * depth))
    elif cls == "traffic_light":
        w, h = 0.030, 0.085
        cx = 0.5 + rng.choice([-1, 1]) * rng.uniform(0.10, 0.28)
        bottom = rng.uniform(0.16, 0.30) + h
    else:  # traffic_sign
        w, h = 0.042, 0.055
        cx = 0.5 + rng.choice([-1, 1]) * rng.uniform(0.26, 0.42)
        bottom = rng.uniform(0.26, 0.38) + h
    x = float(np.clip(cx - w / 2, 0.0, 1.0 - w))
    y = float(np.clip(bottom - h, 0.0, 1.0 - h))
    return [round(x, 4), round(y, 4), round(float(w), 4), round(float(h), 4)]


def _detect(cls: str, ctx: SceneContext, rng: np.random.Generator, **flags: Any) -> dict[str, Any]:
    depth = float(flags.pop("depth", rng.uniform(0.2, 0.95)))
    lane = float(flags.pop("lane", rng.choice([-1.0, 0.0, 1.0])))
    crossing = bool(flags.get("near_road", False))
    small = depth < 0.3 and cls not in ("traffic_light", "traffic_sign")
    conf, factors = score_detection(cls, ctx, rng, small=small, **flags)
    return {
        "cls": cls,
        "confidence": conf,
        "bbox": _bbox(cls, depth, rng, lane=lane, crossing=crossing),
        "occluded": bool(flags.get("occluded", False)),
        "small": small,
        "factors": factors,
    }


# scenario -> (weather options, lighting options, road options)
SCENARIOS: dict[str, tuple[list[str], list[str], list[str]]] = {
    "nominal": (["clear"], ["day", "day", "day", "dawn", "dusk"], ["urban", "highway", "residential", "intersection"]),
    "motorcycles_heavy_rain": (["heavy_rain"], ["day", "dusk", "night"], ["urban", "intersection"]),
    "night_pedestrian_crossing": (["clear", "clear", "rain"], ["night"], ["urban", "residential", "intersection"]),
    "truck_occlusion": (["clear"], ["day", "dusk"], ["highway", "urban"]),
    "tunnel_entry": (["clear"], ["day"], ["tunnel"]),
    "fog_highway": (["fog"], ["dawn", "day"], ["highway"]),
    "dusk_bicycle": (["clear"], ["dusk"], ["residential", "urban"]),
    "dense_intersection": (["clear", "rain"], ["day", "dusk"], ["intersection"]),
    "rain_urban": (["rain"], ["day", "dusk"], ["urban", "residential"]),
    "night_highway": (["clear"], ["night"], ["highway"]),
}

SCENARIO_LABELS: dict[str, str] = {
    "nominal": "Nominal driving",
    "motorcycles_heavy_rain": "Motorcycles in heavy rain",
    "night_pedestrian_crossing": "Night pedestrian crossing",
    "truck_occlusion": "Truck occlusion",
    "tunnel_entry": "Tunnel entry",
    "fog_highway": "Highway fog",
    "dusk_bicycle": "Bicycles at dusk",
    "dense_intersection": "Dense intersection",
    "rain_urban": "Urban rain",
    "night_highway": "Night highway",
}


def sample_context(scenario: str, rng: np.random.Generator) -> SceneContext:
    weather, lighting, roads = SCENARIOS[scenario]
    return SceneContext(str(rng.choice(weather)), str(rng.choice(lighting)), str(rng.choice(roads)))


def generate_detections(scenario: str, ctx: SceneContext, rng: np.random.Generator) -> list[dict[str, Any]]:
    """Produce the simulated detections for one frame of the given scenario."""
    objs: list[dict[str, Any]] = []
    add = lambda cls, **f: objs.append(_detect(cls, ctx, rng, **f))  # noqa: E731

    if scenario == "motorcycles_heavy_rain":
        add("car", lane=-1.0, depth=rng.uniform(0.5, 0.9))
        add("car", lane=1.0, depth=rng.uniform(0.5, 0.9))
        add("motorcycle", lane=rng.choice([-0.5, 0.5]), depth=rng.uniform(0.35, 0.8), between_cars=True)
        if rng.random() < 0.5:
            add("motorcycle", depth=rng.uniform(0.25, 0.6))
    elif scenario == "night_pedestrian_crossing":
        add("pedestrian", depth=rng.uniform(0.3, 0.75), near_road=True)
        add("car", depth=rng.uniform(0.3, 0.9))
        if rng.random() < 0.4:
            add("pedestrian", depth=rng.uniform(0.25, 0.6))
    elif scenario == "truck_occlusion":
        lane = float(rng.choice([-1.0, 1.0]))
        add("truck", lane=lane, depth=rng.uniform(0.55, 0.9))
        add(str(rng.choice(["car", "car", "motorcycle"])), lane=lane * 0.6, depth=rng.uniform(0.3, 0.5), occluded=True)
        add("car", lane=-lane, depth=rng.uniform(0.3, 0.9))
    elif scenario == "tunnel_entry":
        add("car", depth=rng.uniform(0.4, 0.9))
        add(str(rng.choice(["motorcycle", "car", "truck"])), depth=rng.uniform(0.3, 0.7))
        if rng.random() < 0.5:
            add("traffic_sign")
    elif scenario == "fog_highway":
        for _ in range(int(rng.integers(2, 5))):
            add(str(rng.choice(["car", "car", "truck", "bus"])))
    elif scenario == "dusk_bicycle":
        add("bicycle", depth=rng.uniform(0.3, 0.8), lane=rng.choice([-1.0, 1.0]))
        add("car")
        if rng.random() < 0.5:
            add("pedestrian")
    elif scenario == "dense_intersection":
        add("traffic_light")
        for _ in range(int(rng.integers(3, 7))):
            add(str(rng.choice(["car", "car", "motorcycle", "motorcycle", "bus", "pedestrian", "bicycle"])))
    else:  # nominal, rain_urban, night_highway
        pool = ["car", "car", "car", "truck", "bus"] if ctx.road_type == "highway" else \
               ["car", "car", "motorcycle", "motorcycle", "pedestrian", "bicycle", "bus", "truck"]
        for _ in range(int(rng.integers(2, 6))):
            add(str(rng.choice(pool)))
        if ctx.road_type != "highway" and rng.random() < 0.35:
            add(str(rng.choice(["traffic_light", "traffic_sign"])))

    for i, o in enumerate(objs):
        o["id"] = i + 1
        o["source"] = "ai"
    return objs
