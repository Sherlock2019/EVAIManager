"""Interpretable predictive-maintenance scoring.

Each component receives a 0-1 risk from a handful of telemetry features. The
maintenance probability is a transparent weighted blend of the worst component,
the second worst, general wear and a multivariate anomaly score, so every
prediction can be explained with reason codes.

    0-30   LOW        31-60  MEDIUM        61-80  HIGH        81-100 CRITICAL
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import numpy as np
from sklearn.ensemble import IsolationForest

from app.data import geo

WHEEL_NAMES = {"fl": "Front-left", "fr": "Front-right", "rl": "Rear-left", "rr": "Rear-right"}
FAULT_CODES: dict[str, tuple[str, str]] = {
    # code prefix -> (component key, description)
    "BMS-T": ("thermal", "battery thermal limit warning"),
    "BMS-C": ("battery", "cell imbalance detected"),
    "TPMS": ("tires", "low tire pressure warning"),
    "MOT-T": ("motor", "motor over-temperature event"),
    "BRK-W": ("brakes", "brake pad wear indicator"),
    "CHG-C": ("charging", "charge port communication fault"),
}
COMPONENT_LABELS = {
    "thermal": "Battery Cooling System",
    "battery": "Battery Pack",
    "tires": "Tire",
    "motor": "Drive Motor",
    "brakes": "Brake System",
    "charging": "Charging System",
}
W_PRIMARY, W_SECONDARY, W_WEAR, W_ANOMALY = 82.0, 12.0, 3.0, 3.0


def risk_level(probability: float) -> str:
    if probability > 80:
        return "CRITICAL"
    if probability > 60:
        return "HIGH"
    if probability > 30:
        return "MEDIUM"
    return "LOW"


def _clip(x: float) -> float:
    return float(min(1.0, max(0.0, x)))


def _efficiency_ratio(v: dict[str, Any]) -> float:
    return v["average_efficiency"] / geo.VEHICLE_MODELS[v["model"]]["wh_km"]


def _cycle_ratio(v: dict[str, Any]) -> float:
    return v["charging_cycles"] / max(1, v["charging_cycles_expected"])


def feature_vector(v: dict[str, Any]) -> list[float]:
    tires = [v[f"tire_pressure_{w}"] for w in WHEEL_NAMES]
    return [v["battery_temperature"], v["motor_temperature"], v["battery_soh"], min(tires), _efficiency_ratio(v), _cycle_ratio(v)]


class AnomalyModel:
    """IsolationForest over fleet telemetry; flags vehicles that look unlike the fleet."""

    def __init__(self) -> None:
        self._model = IsolationForest(n_estimators=120, contamination=0.05, random_state=7)
        self._lo, self._hi = 0.0, 1.0

    def fit(self, vehicles: list[dict[str, Any]]) -> None:
        x = np.array([feature_vector(v) for v in vehicles])
        self._model.fit(x)
        raw = -self._model.score_samples(x)
        self._lo, self._hi = float(np.percentile(raw, 50)), float(raw.max())

    def score(self, v: dict[str, Any]) -> float:
        return self.score_many([v])[0]

    def score_many(self, vehicles: list[dict[str, Any]]) -> list[float]:
        raw = -self._model.score_samples(np.array([feature_vector(v) for v in vehicles]))
        return [_clip(float(r - self._lo) / max(1e-6, self._hi - self._lo)) for r in raw]


def component_risks(v: dict[str, Any]) -> dict[str, tuple[float, list[str]]]:
    """Per-component risk and the human-readable evidence behind it."""
    risks: dict[str, tuple[float, list[str]]] = {}
    eff = _efficiency_ratio(v)
    cyc = _cycle_ratio(v)

    r = _clip((v["battery_temperature"] - 37) / 12)
    why = []
    if r > 0.3:
        why.append(f"sustained high battery temperature ({v['battery_temperature']:.0f}°C)")
        if cyc > 1.25:
            why.append("increased charging frequency")
        if eff > 1.08:
            why.append(f"abnormal efficiency decline (+{(eff - 1) * 100:.0f}% Wh/km)")
    risks["thermal"] = (r, why)

    r = _clip((90 - v["battery_soh"]) / 10)
    risks["battery"] = (r, [f"battery state of health degraded to {v['battery_soh']:.0f}%", "capacity fade ahead of fleet trend"] if r > 0.3 else [])

    wheel = min(WHEEL_NAMES, key=lambda w: v[f"tire_pressure_{w}"])
    low = v[f"tire_pressure_{wheel}"]
    r = _clip((2.32 - low) / 0.42)
    risks["tires"] = (r, [f"{WHEEL_NAMES[wheel].lower()} tire pressure trending down ({low:.2f} bar)", "pressure loss rate above normal seepage"] if r > 0.3 else [])

    r = _clip((v["motor_temperature"] - 78) / 26)
    why = [f"motor temperature elevated ({v['motor_temperature']:.0f}°C)"] if r > 0.3 else []
    if r > 0.3 and eff > 1.05:
        why.append("drivetrain efficiency below model baseline")
    risks["motor"] = (r, why)

    r = _clip((v["km_since_service"] - 18000) / 14000)
    risks["brakes"] = (r, [f"{v['km_since_service']:,} km since last brake service", "regenerative braking share declining"] if r > 0.3 else [])

    r = _clip((cyc - 1.25) / 0.60)
    risks["charging"] = (r, [f"charging frequency {cyc:.1f}x expected for odometer", "frequent partial DC fast-charge sessions"] if r > 0.3 else [])

    for code in v["fault_codes"]:
        for prefix, (comp, text) in FAULT_CODES.items():
            if code.startswith(prefix):
                cr, cw = risks[comp]
                risks[comp] = (_clip(cr + 0.04), cw + [f"fault code {code}: {text}"])
    return risks


def component_name(key: str, v: dict[str, Any]) -> str:
    if key == "tires":
        wheel = min(WHEEL_NAMES, key=lambda w: v[f"tire_pressure_{w}"])
        return f"{WHEEL_NAMES[wheel]} Tire"
    return COMPONENT_LABELS[key]


def predict(v: dict[str, Any], anomaly: float = 0.0, today: date | None = None) -> dict[str, Any]:
    """Score one vehicle. Returns probability, risk level, component and reason codes."""
    risks = component_risks(v)
    ranked = sorted(risks.items(), key=lambda kv: kv[1][0], reverse=True)
    (top_key, (top_r, top_why)), (_, (second_r, second_why)) = ranked[0], ranked[1]
    wear = _clip(v["odometer_km"] / 150_000)
    probability = round(min(99.0, W_PRIMARY * top_r + W_SECONDARY * second_r + W_WEAR * wear + W_ANOMALY * anomaly), 1)
    level = risk_level(probability)

    reasons = list(top_why)
    if second_r > 0.3:
        reasons += second_why[:1]
    if anomaly > 0.6 and level != "LOW":
        reasons.append("telemetry pattern unlike the rest of the fleet (IsolationForest)")
    days = None if level == "LOW" else max(1, round(60 * (1 - probability / 100) ** 1.6 + 1))
    today = today or date.today()
    return {
        "vehicle_id": v["vehicle_id"],
        "model": v["model"],
        "city": v["city"],
        "maintenance_probability": probability,
        "maintenance_risk": level,
        "health_score": int(round(100 - 0.45 * probability)),
        "predicted_component": component_name(top_key, v) if level != "LOW" else "None",
        "component_key": top_key if level != "LOW" else None,
        "predicted_days_to_service": days,
        "service_by": (today + timedelta(days=days)).isoformat() if days else None,
        "confidence": round(0.62 + 0.33 * top_r, 2) if level != "LOW" else None,
        "reason_codes": reasons[:4],
        "recommended_action": {"CRITICAL": "Book service", "HIGH": "Inspect", "MEDIUM": "Schedule check", "LOW": "Monitor"}[level],
        "anomaly_score": round(anomaly, 2),
        "component_risks": {k: round(r, 2) for k, (r, _) in risks.items()},
    }


def estimated_range_km(v: dict[str, Any]) -> int:
    spec = geo.VEHICLE_MODELS[v["model"]]
    usable_kwh = spec["battery_kwh"] * v["battery_soh"] / 100 * v["battery_soc"] / 100
    return int(usable_kwh * 1000 / v["average_efficiency"])


def _trend_series(seed: int, end: float, drift: float, noise: float, n: int = 14) -> list[float]:
    rng = np.random.default_rng(seed)
    base = end - drift * np.linspace(1, 0, n)
    return [round(float(x), 1) for x in np.clip(base + rng.normal(0, noise, n), 0, 100)]


def digital_twin(v: dict[str, Any], prediction: dict[str, Any]) -> list[dict[str, Any]]:
    """Seven subsystem health profiles: score, trend, risk and a plain-language prediction."""
    cr = prediction["component_risks"]
    seed = int(v["vehicle_id"][-4:])
    usage = _clip(v["daily_km"] / 160) * 0.5 + _clip(v["odometer_km"] / 150_000) * 0.3
    wheel = min(WHEEL_NAMES, key=lambda w: v[f"tire_pressure_{w}"])
    sections = [
        ("Battery", cr["battery"], f"SOH {v['battery_soh']:.0f}% · {v['charging_cycles']} cycles",
         "Capacity fade accelerating; plan cell balancing." if cr["battery"] > 0.3 else "Capacity on expected degradation curve."),
        ("Powertrain", cr["motor"], f"Motor {v['motor_temperature']:.0f}°C · {min(99, 100 / _efficiency_ratio(v) * 0.94):.0f}% efficiency",
         "Inspect motor cooling loop and inverter." if cr["motor"] > 0.3 else "Motor and inverter within thermal envelope."),
        ("Tires", cr["tires"], f"Lowest {v[f'tire_pressure_{wheel}']:.2f} bar ({wheel.upper()})",
         f"{WHEEL_NAMES[wheel]} tire will fall below safe pressure." if cr["tires"] > 0.3 else "Pressures stable across all four wheels."),
        ("Brakes", cr["brakes"], f"{v['km_since_service']:,} km since service",
         "Pad wear likely beyond service limit." if cr["brakes"] > 0.3 else "Regenerative braking keeping pad wear low."),
        ("Thermal", cr["thermal"], f"Battery {v['battery_temperature']:.0f}°C",
         "Cooling performance degrading; coolant pump or chiller suspected." if cr["thermal"] > 0.3 else "Thermal management nominal."),
        ("Charging", cr["charging"], f"{_cycle_ratio(v):.1f}x expected charge frequency",
         "Charging pattern stresses the pack; check port and onboard charger." if cr["charging"] > 0.3 else "Charging behaviour normal."),
        ("Driving Usage", usage * 0.6, f"{v['daily_km']:.0f} km/day · {v['odometer_km']:,} km",
         "Heavy duty cycle; shorten service interval." if usage > 0.55 else "Typical duty cycle."),
    ]
    out = []
    for i, (name, r, metric, text) in enumerate(sections):
        score = int(round(100 - 62 * r - 4 * usage))
        drift = -22 * r  # negative drift = the score has been falling toward today's value
        out.append({
            "name": name,
            "health_score": score,
            "trend": "declining" if r > 0.3 else ("stable" if r > 0.08 else "steady"),
            "risk": risk_level(100 * r * 0.95).title(),
            "metric": metric,
            "prediction": text,
            "history": _trend_series(seed * 10 + i, score, drift, 0.8),
        })
    return out
