"""In-memory world state backed by SQLite.

The repository is the single data-access layer: routers and services read and
mutate the world through it. Generated data is persisted on first start and
reloaded afterwards, so reviews and bookings survive restarts.
"""
from __future__ import annotations

import copy
import logging
from typing import Any

from app import config
from app.data import database, generator
from app.services import maintenance_engine

log = logging.getLogger("mobility.repo")


class Repository:
    def __init__(self) -> None:
        self.vehicles: list[dict[str, Any]] = []
        self.vehicle_index: dict[str, int] = {}
        self.predictions: dict[str, dict[str, Any]] = {}
        self.chargers: list[dict[str, Any]] = []
        self.routes: list[dict[str, Any]] = []
        self.route_index: dict[str, dict[str, Any]] = {}
        self.frames: list[dict[str, Any]] = []
        self.frame_index: dict[str, dict[str, Any]] = {}
        self.datasets: list[dict[str, Any]] = []
        self.candidate_sites: list[dict[str, Any]] = []
        self.planned_sites: list[dict[str, Any]] = []
        self.bookings: list[dict[str, Any]] = []
        self.reviews: list[dict[str, Any]] = []
        self.anomaly_model = maintenance_engine.AnomalyModel()
        self._pristine: dict[str, dict[str, Any]] = {}

    # -- lifecycle ---------------------------------------------------------
    def load(self, force_regenerate: bool = False) -> None:
        if force_regenerate or not database.exists():
            log.info("Generating synthetic world (seed=%s)…", config.SEED)
            world = generator.generate_all(config.SEED, config.FLEET_SIZE, config.FRAME_COUNT)
            database.save_world(world)
        world = database.load_world()
        self.vehicles = world["vehicles"]
        self.vehicle_index = {v["vehicle_id"]: i for i, v in enumerate(self.vehicles)}
        self.chargers = world["chargers"]
        self.routes = world["routes"]
        self.route_index = {r["route_id"]: r for r in self.routes}
        self.frames = world["frames"]
        self.frame_index = {f["frame_id"]: f for f in self.frames}
        self.datasets = world["datasets"]
        self.candidate_sites = world["candidate_sites"]
        self.planned_sites = world["planned_sites"]
        self.bookings = world["bookings"]
        self.reviews = world["reviews"]
        self.anomaly_model.fit(self.vehicles)
        for v, anomaly in zip(self.vehicles, self.anomaly_model.score_many(self.vehicles)):
            self.refresh_prediction(v, anomaly)
        # Snapshots let the guided demo restore the entities it mutates.
        self._pristine = {
            generator.DEMO_VEHICLE_ID: copy.deepcopy(self.get_vehicle(generator.DEMO_VEHICLE_ID)),
        }
        log.info("World ready: %d vehicles, %d chargers, %d frames", len(self.vehicles), len(self.chargers), len(self.frames))

    # -- vehicles ----------------------------------------------------------
    def get_vehicle(self, vehicle_id: str) -> dict[str, Any] | None:
        i = self.vehicle_index.get(normalize_vehicle_id(vehicle_id))
        return self.vehicles[i] if i is not None else None

    def refresh_prediction(self, v: dict[str, Any], anomaly: float | None = None) -> dict[str, Any]:
        p = maintenance_engine.predict(v, self.anomaly_model.score(v) if anomaly is None else anomaly)
        self.predictions[v["vehicle_id"]] = p
        v["health_score"] = p["health_score"]
        v["maintenance_risk"] = p["maintenance_risk"]
        if v["status"] not in ("offline", "charging") or p["maintenance_risk"] in ("CRITICAL", "HIGH"):
            if v["status"] != "offline":
                v["status"] = display_status(v, p)
        return p

    def pristine(self, key: str) -> dict[str, Any]:
        return copy.deepcopy(self._pristine[key])

    # -- frames ------------------------------------------------------------
    def get_frame(self, frame_id: str) -> dict[str, Any] | None:
        return self.frame_index.get(frame_id)

    def review_queue(self) -> list[dict[str, Any]]:
        queue = [f for f in self.frames if f["review_required"] and f["label_status"] == "pending_review"]
        queue.sort(key=lambda f: f["model_confidence"])
        return queue

    def dataset(self, version: str) -> dict[str, Any]:
        return next(d for d in self.datasets if d["version"] == version)


def normalize_vehicle_id(raw: str) -> str:
    """Accept 'VF-EV-0821', 'VF-0821' or '821'."""
    digits = "".join(ch for ch in raw if ch.isdigit())
    return f"VF-EV-{int(digits):04d}" if digits else raw


def display_status(v: dict[str, Any], p: dict[str, Any]) -> str:
    if p["maintenance_risk"] == "CRITICAL":
        return "critical"
    if p["maintenance_risk"] in ("HIGH", "MEDIUM"):
        return "warning"
    return "charging" if v["status"] == "charging" else "healthy"


repo = Repository()
