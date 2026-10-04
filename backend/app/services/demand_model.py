"""Passenger demand forecasting model.

A real gradient-boosted model (scikit-learn HistGradientBoostingRegressor,
Poisson loss) trained on synthetic ride history. The history is generated from
the zone model in ride_demand.py plus the effects a real city adds: day of the
week, afternoon rain, slow growth and counting noise. The model never sees those
rules; it has to learn them from the rows, and is scored on a held-out week
against the usual naive forecast ("same hour last week").
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.inspection import permutation_importance

from app import config
from app.data.repository import Repository
from app.services import ride_demand

WARMUP_DAYS = 7       # needed before the first row has a full week of lags
HISTORY_DAYS = 56     # eight weeks of hourly rows per zone
TEST_DAYS = 7         # the last week is held out
RAIN_DAY_SHARE = 0.35
RAIN_UPLIFT = 1.28    # riders switch from motorbikes to cars when it rains
DAILY_GROWTH = 0.0015
DAY_FACTOR = [0.97, 1.0, 1.0, 1.02, 1.08, 1.0, 0.96]  # Mon..Sun, on top of the weekday/weekend shape
DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

FEATURES = ["hour", "day_of_week", "is_weekend", "zone", "zone_type", "rain", "lag_24h", "lag_168h", "rolling_7d"]
FEATURE_LABEL = {
    "hour": "Hour of day", "day_of_week": "Day of week", "is_weekend": "Weekend flag", "zone": "Zone",
    "zone_type": "Zone type", "rain": "Rain (weather feed)", "lag_24h": "Pickups 24 h ago",
    "lag_168h": "Pickups same hour last week", "rolling_7d": "7-day average for this hour",
}
FEATURE_SOURCE = {
    "hour": "Clock", "day_of_week": "Calendar", "is_weekend": "Calendar", "zone": "GPS geofence",
    "zone_type": "Map data", "rain": "Weather feed", "lag_24h": "Seat + door sensors",
    "lag_168h": "Seat + door sensors", "rolling_7d": "Seat + door sensors",
}


@dataclass
class Trained:
    model: HistGradientBoostingRegressor
    zones: list[str]
    zone_types: list[int]
    history: np.ndarray        # pickups[day, hour, zone], warm-up days included
    card: dict[str, Any]


_trained: Trained | None = None


def _history(repo: Repository) -> tuple[np.ndarray, np.ndarray, list[str], list[int]]:
    """Synthetic hourly pickups per zone and the rain flag per hour."""
    shapes = {}
    for day in ("weekday", "weekend"):
        f = ride_demand.forecast(repo, day)  # type: ignore[arg-type]
        shapes[day] = np.array([[z["pickups"] for z in h["zones"]] for h in f["hours"]], dtype=float)
    zones = [z["name"] for z in f["zones"]]
    kinds = sorted({z["kind"] for z in f["zones"]})
    zone_types = [kinds.index(z["kind"]) for z in f["zones"]]

    rng = np.random.default_rng(config.SEED + 7)
    days = WARMUP_DAYS + HISTORY_DAYS
    rain = np.zeros((days, 24), dtype=int)
    pickups = np.zeros((days, 24, len(zones)))
    for d in range(days):
        if rng.random() < RAIN_DAY_SHARE:  # tropical afternoon downpour
            start = int(rng.integers(13, 20))
            rain[d, start:start + int(rng.integers(2, 5))] = 1
        dow = d % 7
        expected = shapes["weekend" if dow >= 5 else "weekday"] * DAY_FACTOR[dow] * (1 + DAILY_GROWTH * d)
        pickups[d] = rng.poisson(expected * np.where(rain[d] == 1, RAIN_UPLIFT, 1.0)[:, None])
    return pickups, rain, zones, zone_types


def _rows(pickups: np.ndarray, rain: np.ndarray, zone_types: list[int], days: range) -> tuple[np.ndarray, np.ndarray]:
    x, y = [], []
    for d in days:
        week = pickups[d - 7:d].mean(axis=0)
        for h in range(24):
            for z in range(pickups.shape[2]):
                x.append([h, d % 7, int(d % 7 >= 5), z, zone_types[z], rain[d, h], pickups[d - 1, h, z], pickups[d - 7, h, z], week[h, z]])
                y.append(pickups[d, h, z])
    return np.array(x, dtype=float), np.array(y)


def _scores(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float]:
    err = actual - predicted
    return {
        "mae": round(float(np.abs(err).mean()), 2),
        "wape_pct": round(float(100 * np.abs(err).sum() / actual.sum()), 1),
        "r2": round(float(1 - (err ** 2).sum() / ((actual - actual.mean()) ** 2).sum()), 3),
    }


def train(repo: Repository) -> Trained:
    """Train once per process; about a second on a laptop CPU."""
    global _trained
    if _trained is not None:
        return _trained
    pickups, rain, zones, zone_types = _history(repo)
    days = pickups.shape[0]
    split = days - TEST_DAYS
    x_train, y_train = _rows(pickups, rain, zone_types, range(WARMUP_DAYS, split))
    x_test, y_test = _rows(pickups, rain, zone_types, range(split, days))

    model = HistGradientBoostingRegressor(loss="poisson", max_iter=220, learning_rate=0.07, max_leaf_nodes=24,
                                          categorical_features=[FEATURES.index("zone")], random_state=0)
    model.fit(x_train, y_train)
    predicted = model.predict(x_test)
    baseline = x_test[:, FEATURES.index("lag_168h")]
    model_scores, naive_scores = _scores(y_test, predicted), _scores(y_test, baseline)

    perm = permutation_importance(model, x_test, y_test, n_repeats=3, random_state=0, scoring="neg_mean_absolute_error")
    gain = np.maximum(perm.importances_mean, 0.0)
    importance = sorted(({"feature": name, "label": FEATURE_LABEL[name], "source": FEATURE_SOURCE[name],
                          "share_pct": round(float(100 * g / gain.sum()), 1), "mae_increase": round(float(g), 2)}
                         for name, g in zip(FEATURES, gain)), key=lambda r: r["share_pct"], reverse=True)

    n_zones = len(zones)
    shape = (TEST_DAYS * 24, n_zones)  # rows are ordered day, hour, zone
    wet = x_test[:, FEATURES.index("rain")] == 1
    card = {
        "name": "Ride Demand Forecaster v1",
        "algorithm": "Gradient-boosted decision trees (scikit-learn HistGradientBoostingRegressor, Poisson loss)",
        "target": "Passenger pickups per zone per hour",
        "trained_on": f"{HISTORY_DAYS - TEST_DAYS} days of synthetic hourly ride history, {n_zones} zones",
        "training_rows": int(len(y_train)), "test_rows": int(len(y_test)),
        "test_period": f"last {TEST_DAYS} days, never seen in training",
        "note": "A real trained model, but the history it learns from is synthetic. Scores say how well it recovers "
                "the simulated patterns, not how it would do on real VinFast data.",
        "metrics": {"model": model_scores, "baseline": naive_scores, "baseline_name": "Same hour last week",
                    "mae_improvement_pct": round(100 * (1 - model_scores["mae"] / naive_scores["mae"]), 1),
                    "rain_hours": {"model": _scores(y_test[wet], predicted[wet]), "baseline": _scores(y_test[wet], baseline[wet])} if wet.any() else None},
        "importance": importance,
        "zones": zones,
        "test_week": {
            "labels": [f"{DAY_NAMES[d % 7]} {h:02d}:00" for d in range(split, days) for h in range(24)],
            "rain": rain[split:].reshape(-1).tolist(),
            "actual": y_test.reshape(shape).T.astype(int).tolist(),
            "predicted": np.round(predicted.reshape(shape).T, 1).tolist(),
            "baseline": baseline.reshape(shape).T.astype(int).tolist(),
        },
        "pipeline": ["IoT signals", "Hourly pickups per zone", "Features (time, weather, lags)", "Gradient-boosted model",
                     "24 h forecast", "Driver positioning + charger sizing"],
    }
    _trained = Trained(model, zones, zone_types, pickups, card)
    return _trained


def model_card(repo: Repository) -> dict[str, Any]:
    return train(repo).card


def predict(repo: Repository, zone: int, hour: int, day_of_week: int, rain: bool) -> dict[str, Any]:
    """What-if forecast for one zone and hour, using typical recent history as the lags."""
    t = train(repo)
    recent = t.history[-28:]                                # last four weeks
    same_day = recent[(np.arange(len(recent)) + len(t.history) - 28) % 7 == day_of_week]
    day_before = recent[(np.arange(len(recent)) + len(t.history) - 28) % 7 == (day_of_week - 1) % 7]
    lags = [day_before[:, hour, zone].mean(), same_day[:, hour, zone].mean(), recent[:, hour, zone].mean()]
    row = [hour, day_of_week, int(day_of_week >= 5), zone, t.zone_types[zone]]
    dry, wet = t.model.predict(np.array([row + [0] + lags, row + [1] + lags], dtype=float))
    chosen = wet if rain else dry
    return {
        "zone": t.zones[zone], "hour": hour, "day": DAY_NAMES[day_of_week], "rain": rain,
        "predicted_pickups": round(float(chosen), 1),
        "dry_pickups": round(float(dry), 1), "rain_pickups": round(float(wet), 1),
        "rain_effect_pct": round(float(100 * (wet / dry - 1)), 1) if dry > 0 else 0.0,
        "typical_pickups": round(float(lags[1]), 1),
        "evs_needed": int(np.ceil(chosen / ride_demand.RIDES_PER_EV_HOUR)),
    }
