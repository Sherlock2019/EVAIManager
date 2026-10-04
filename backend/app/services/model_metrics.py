"""Mock ADAS model metrics.

All numbers are fabricated for the demo. They are arranged so the story is
consistent: v6 was trained on a dataset enriched with human corrections, and
each new correction nudges the simulated "next candidate" a little further.
"""
from __future__ import annotations

from typing import Any

NOTE = "MOCK DEMO DATA — simulated metrics, not measurements of a real perception model."

OVERALL = {
    "ADAS Vision v5": {"precision": 0.871, "recall": 0.823, "map": 0.78, "false_positive_rate": 0.064, "false_negative_rate": 0.177},
    "ADAS Vision v6": {"precision": 0.902, "recall": 0.884, "map": 0.84, "false_positive_rate": 0.047, "false_negative_rate": 0.116},
}

# recall per slice: (v5, v6)
BREAKDOWNS: dict[str, dict[str, tuple[float, float]]] = {
    "object_class": {
        "car": (0.93, 0.95), "truck": (0.90, 0.93), "bus": (0.89, 0.92), "motorcycle": (0.762, 0.871),
        "bicycle": (0.74, 0.83), "pedestrian": (0.814, 0.897), "traffic_light": (0.88, 0.91), "traffic_sign": (0.90, 0.92),
    },
    "weather": {"clear": (0.88, 0.92), "rain": (0.80, 0.87), "heavy_rain": (0.66, 0.78), "fog": (0.70, 0.79)},
    "lighting": {"day": (0.88, 0.92), "dawn": (0.83, 0.88), "dusk": (0.81, 0.87), "night": (0.72, 0.82)},
    "city": {"Ho Chi Minh City": (0.79, 0.87), "Hanoi": (0.82, 0.88), "Da Nang": (0.85, 0.90), "Hai Phong": (0.84, 0.89), "Nha Trang": (0.86, 0.90)},
    "vehicle_type": {"VF 3": (0.80, 0.87), "VF 5": (0.81, 0.88), "VF 6": (0.82, 0.88), "VF 7": (0.83, 0.89), "VF 8": (0.84, 0.90), "VF 9": (0.84, 0.90)},
}

FEEDBACK_IMPACT = [
    {"metric": "Pedestrian Recall", "before": 81.4, "after": 89.7},
    {"metric": "Motorcycle Recall", "before": 76.2, "after": 87.1},
]

# Simulated uplift per human correction on the next model candidate (capped).
UPLIFT_PER_CORRECTION = 0.0015
MAX_UPLIFT = 0.03


def build(corrections_by_class: dict[str, int]) -> dict[str, Any]:
    """Assemble the model dashboard payload, including the feedback-driven candidate."""
    def uplift(cls: str) -> float:
        return min(MAX_UPLIFT, corrections_by_class.get(cls, 0) * UPLIFT_PER_CORRECTION)

    total = sum(corrections_by_class.values())
    moto, ped = 0.871 + uplift("motorcycle"), 0.897 + uplift("pedestrian")
    return {
        "note": NOTE,
        "models": [{"name": name, "status": "Previous" if name.endswith("v5") else "Production", **m} for name, m in OVERALL.items()],
        "comparison": [
            {"metric": "mAP", "v5": 0.78, "v6": 0.84},
            {"metric": "Precision", "v5": 0.871, "v6": 0.902},
            {"metric": "Recall", "v5": 0.823, "v6": 0.884},
            {"metric": "Pedestrian Recall", "v5": 0.814, "v6": 0.897},
            {"metric": "Motorcycle Recall", "v5": 0.762, "v6": 0.871},
            {"metric": "False Positive Rate", "v5": 0.064, "v6": 0.047, "lower_is_better": True},
            {"metric": "False Negative Rate", "v5": 0.177, "v6": 0.116, "lower_is_better": True},
        ],
        "breakdowns": {
            dim: [{"slice": k, "v5": a, "v6": b} for k, (a, b) in rows.items()] for dim, rows in BREAKDOWNS.items()
        },
        "feedback_impact": FEEDBACK_IMPACT,
        "candidate": {
            "name": "ADAS Vision v7-rc (simulated)",
            "trained_on": "ADAS-v24 (building)",
            "session_corrections": total,
            "motorcycle_recall": round(moto, 4),
            "pedestrian_recall": round(ped, 4),
            "map": round(0.84 + min(0.012, total * 0.0006), 4),
            "baseline": {"motorcycle_recall": 0.871, "pedestrian_recall": 0.897, "map": 0.84},
        },
        "history": [
            {"version": "v3", "map": 0.69, "recall": 0.74}, {"version": "v4", "map": 0.74, "recall": 0.79},
            {"version": "v5", "map": 0.78, "recall": 0.823}, {"version": "v6", "map": 0.84, "recall": 0.884},
        ],
    }
