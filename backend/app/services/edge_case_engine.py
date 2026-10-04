"""Edge case miner: find the scenarios where the model is most likely to fail.

Groups frames by scenario, estimates an error rate from confidence (a simple
calibration curve standing in for audited ground truth) and prioritises the
scenarios that deserve more training data.
"""
from __future__ import annotations

from typing import Any

from app.services.adas_label_engine import SCENARIO_LABELS

SCENARIO_FOCUS = {
    "motorcycles_heavy_rain": "night/rain motorcycle",
    "night_pedestrian_crossing": "night pedestrian crossing",
    "truck_occlusion": "truck-occlusion",
    "tunnel_entry": "tunnel entry/exit",
    "fog_highway": "highway fog",
    "dusk_bicycle": "dusk bicycle",
    "dense_intersection": "dense intersection",
    "rain_urban": "urban rain",
    "night_highway": "night highway",
}


def estimated_error_rate(avg_confidence: float) -> float:
    """Calibration curve: lower confidence -> more label errors found on audit."""
    return max(0.0, 0.75 * (0.90 - avg_confidence))


def priority(error_rate: float) -> str:
    if error_rate >= 0.20:
        return "CRITICAL"
    if error_rate >= 0.14:
        return "HIGH"
    if error_rate >= 0.08:
        return "MEDIUM"
    return "LOW"


def mine(frames: list[dict[str, Any]]) -> dict[str, Any]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for f in frames:
        if f["scenario_category"] != "nominal":
            groups.setdefault(f["scenario_category"], []).append(f)

    cases = []
    for key, items in groups.items():
        avg = sum(f["model_confidence"] for f in items) / len(items)
        err = estimated_error_rate(avg)
        cities: dict[str, int] = {}
        for f in items:
            cities[f["city"]] = cities.get(f["city"], 0) + 1
        top_city = max(cities, key=cities.get)  # type: ignore[arg-type]
        weakest = sorted(items, key=lambda f: f["model_confidence"])[:6]
        cases.append({
            "key": key,
            "scenario": SCENARIO_LABELS[key],
            "events": len(items),
            "average_confidence": round(avg, 3),
            "error_rate": round(err, 3),
            "priority": priority(err),
            "pending_review": sum(1 for f in items if f["label_status"] == "pending_review"),
            "human_corrected": sum(1 for f in items if f["label_status"] == "human_corrected"),
            "top_city": top_city,
            "top_city_events": cities[top_city],
            # only scenarios that actually hurt the model earn a data request
            "frames_requested": int(round(len(items) * err * 33 / 500) * 500) if priority(err) != "LOW" else 0,
            "sample_frames": [f["frame_id"] for f in weakest],
        })
    rank = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}
    cases.sort(key=lambda c: (rank[c["priority"]], -c["events"] * c["error_rate"]))

    top = cases[0]
    recommendation = (
        f"Add {top['frames_requested']:,} additional {SCENARIO_FOCUS[top['key']]} frames to next training cycle."
    )
    return {
        "cases": cases,
        "recommendation": recommendation,
        "recommendations": [
            {"scenario": c["scenario"], "priority": c["priority"],
             "text": f"Add {c['frames_requested']:,} {SCENARIO_FOCUS[c['key']]} frames to ADAS-v24."}
            for c in cases if c["priority"] in ("CRITICAL", "HIGH") and c["frames_requested"] > 0
        ],
        "note": "Error rates are simulated from confidence; mock demo data.",
    }
