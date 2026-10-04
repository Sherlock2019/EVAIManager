"""Live fleet simulation.

Every tick the simulator moves vehicles, drains or charges batteries, shifts
charger availability and emits ADAS events, then broadcasts a compact delta to
all connected WebSocket clients. One tick represents one simulated minute.
"""
from __future__ import annotations

import asyncio
import logging
import math
from collections import deque
from datetime import datetime
from typing import Any

import numpy as np
from fastapi import WebSocket

from app import config
from app.data import geo
from app.data.generator import VN_TZ, _apply_issue
from app.data.repository import Repository, display_status
from app.services import dashboard_service
from app.services.adas_label_engine import SCENARIO_LABELS

log = logging.getLogger("mobility.sim")

STATUS_CODES = {"healthy": 0, "charging": 1, "warning": 2, "critical": 3, "offline": 4}
KM_PER_DEG_LAT = 111.0


class LiveSimulation:
    def __init__(self, repo: Repository) -> None:
        self.repo = repo
        self.rng = np.random.default_rng(config.SEED + 1)
        self.seq = 0
        self.running = True
        self.speed = 1.0
        self.frames_today = 2_840_000
        self.events: deque[dict[str, Any]] = deque(maxlen=60)
        self.clients: set[WebSocket] = set()
        self.last_tick: dict[str, Any] = {}
        self._route_cum: dict[str, np.ndarray] = {}
        self._task: asyncio.Task[None] | None = None

    # -- lifecycle ---------------------------------------------------------
    def prepare(self) -> None:
        self._route_cum.clear()
        for r in self.repo.routes:
            c = r["coords"]
            seg = [geo.haversine_km(a[0], a[1], b[0], b[1]) for a, b in zip(c[:-1], c[1:])]
            self._route_cum[r["route_id"]] = np.concatenate([[0.0], np.cumsum(seg)])
        for v in self.repo.vehicles:
            v["_home"] = (v["latitude"], v["longitude"])
            v["_heading"] = float(self.rng.uniform(0, 2 * math.pi))

    def start(self) -> None:
        self.prepare()
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()

    async def _run(self) -> None:
        while True:
            try:
                if self.running:
                    await self.broadcast(self.tick())
            except Exception:  # keep the loop alive; a bad tick must not kill the demo
                log.exception("simulation tick failed")
            await asyncio.sleep(config.TICK_SECONDS / max(0.25, self.speed))

    # -- simulation --------------------------------------------------------
    def _move_on_route(self, v: dict[str, Any], hours: float) -> float:
        route = self.repo.route_index[v["route_id"]]
        cum = self._route_cum[v["route_id"]]
        total = float(cum[-1])
        km = v["speed_kmh"] * hours * (3.0 if route["kind"] == "corridor" else 1.0)
        progress = (v.get("route_progress") or 0.0) + (v.get("route_direction") or 1) * km / total
        if progress >= 1.0:
            progress, v["route_direction"] = 1.0, -1
        elif progress <= 0.0:
            progress, v["route_direction"] = 0.0, 1
        v["route_progress"] = progress
        coords = np.asarray(route["coords"])
        d = progress * total
        v["latitude"] = round(float(np.interp(d, cum, coords[:, 0])), 6)
        v["longitude"] = round(float(np.interp(d, cum, coords[:, 1])), 6)
        return km / (3.0 if route["kind"] == "corridor" else 1.0)

    def _wander(self, v: dict[str, Any], hours: float) -> float:
        km = v["speed_kmh"] * hours * 0.5  # stop-and-go urban driving
        home_lat, home_lon = v["_home"]
        if geo.haversine_km(v["latitude"], v["longitude"], home_lat, home_lon) > 3.5:
            v["_heading"] = math.atan2(home_lon - v["longitude"], home_lat - v["latitude"])
        v["_heading"] += float(self.rng.normal(0, 0.35))
        v["latitude"] = round(v["latitude"] + math.cos(v["_heading"]) * km / KM_PER_DEG_LAT, 6)
        v["longitude"] = round(v["longitude"] + math.sin(v["_heading"]) * km / (KM_PER_DEG_LAT * math.cos(math.radians(v["latitude"]))), 6)
        return km

    def tick(self) -> dict[str, Any]:
        self.seq += 1
        hours = config.SIM_SECONDS_PER_TICK / 3600
        positions: list[list[float]] = []
        for i, v in enumerate(self.repo.vehicles):
            status = v["status"]
            if status == "offline":
                continue
            if status == "charging":
                v["battery_soc"] = round(min(100.0, v["battery_soc"] + 0.9), 1)
                if v["battery_soc"] >= 90:
                    v["status"] = "healthy"
                    v["moving"] = bool(v.get("route_id")) or self.rng.random() < 0.6
                    v["speed_kmh"] = round(float(self.rng.uniform(22, 50)), 1) if v["moving"] else 0.0
                positions.append([i, v["latitude"], v["longitude"], v["battery_soc"], STATUS_CODES[v["status"]], 0])
                continue
            if not v["moving"]:
                continue
            km = self._move_on_route(v, hours) if v.get("route_id") else self._wander(v, hours)
            spec = geo.VEHICLE_MODELS[v["model"]]
            v["battery_soc"] = round(max(5.0, v["battery_soc"] - km * v["average_efficiency"] / 1000 / spec["battery_kwh"] * 100), 1)
            if v["maintenance_risk"] == "LOW":
                # normal thermal noise only; an anomalous reading (injected fault, demo) is left
                # untouched until the maintenance engine has scored it
                if v["battery_temperature"] <= 37.5:
                    v["battery_temperature"] = round(float(np.clip(v["battery_temperature"] + self.rng.normal(0, 0.15), 28, 37.5)), 1)
                if v["battery_soc"] < 14:
                    v["status"], v["speed_kmh"] = "charging", 0.0
            positions.append([i, v["latitude"], v["longitude"], v["battery_soc"], STATUS_CODES[v["status"]], round(v["speed_kmh"])])

        # a few parked vehicles plug in each tick, so the charging population stays steady
        for i in self.rng.integers(0, len(self.repo.vehicles), size=4):
            v = self.repo.vehicles[int(i)]
            if v["status"] == "healthy" and not v["moving"] and v["maintenance_risk"] == "LOW":
                v["status"] = "charging"
                v["battery_soc"] = round(float(self.rng.uniform(20, 55)), 1)
                positions.append([int(i), v["latitude"], v["longitude"], v["battery_soc"], STATUS_CODES["charging"], 0])

        chargers: list[list[int]] = []
        for j in self.rng.choice(len(self.repo.chargers), size=18, replace=False):
            c = self.repo.chargers[int(j)]
            target = c["ports"] * (1 - c["utilization"])
            step = int(self.rng.integers(-2, 3)) + (1 if c["available"] < target - 1 else -1 if c["available"] > target + 1 else 0)
            c["available"] = int(np.clip(c["available"] + step, 0, c["ports"]))
            chargers.append([int(j), c["available"]])

        new_events = [self._adas_event() for _ in range(int(self.rng.integers(1, 4)))]
        self.frames_today += int(self.rng.integers(900, 1500))
        self.last_tick = {
            "type": "tick", "seq": self.seq, "ts": datetime.now(VN_TZ).isoformat(timespec="seconds"),
            "positions": positions, "chargers": chargers, "adas_events": new_events,
            "summary": dashboard_service.summary(self.repo, self),
        }
        return self.last_tick

    def _adas_event(self) -> dict[str, Any]:
        frames = self.repo.frames
        f = frames[int(self.rng.integers(len(frames)))]
        for _ in range(3):  # bias the live feed toward interesting (lower-confidence) frames
            if f["model_confidence"] < 0.85:
                break
            f = frames[int(self.rng.integers(len(frames)))]
        weakest = min(f["objects"], key=lambda o: o["confidence"]) if f["objects"] else None
        event = {
            "id": f"EV-{self.seq:05d}-{int(self.rng.integers(1000, 9999))}",
            "frame_id": f["frame_id"], "vehicle_id": f["vehicle_id"], "city": f["city"],
            "lat": f["latitude"], "lon": f["longitude"],
            "cls": weakest["cls"] if weakest else "none",
            "confidence": f["model_confidence"],
            "scenario": SCENARIO_LABELS[f["scenario_category"]],
            "routing": "auto_accept" if f["model_confidence"] >= 0.9 else "sample_review" if f["model_confidence"] >= 0.7 else "human_review",
            "ts": datetime.now(VN_TZ).strftime("%H:%M:%S"),
        }
        self.events.appendleft(event)
        return event

    # -- controls ----------------------------------------------------------
    def inject_issue(self, vehicle_id: str | None, issue: str) -> dict[str, Any]:
        if vehicle_id:
            v = self.repo.get_vehicle(vehicle_id)
        else:
            healthy = [x for x in self.repo.vehicles if x["maintenance_risk"] == "LOW" and x["status"] != "offline"]
            v = healthy[int(self.rng.integers(len(healthy)))]
        if v is None:
            raise KeyError(vehicle_id)
        _apply_issue(v, issue if issue in ("thermal", "tire", "battery", "motor", "brakes", "charging") else "thermal",
                     float(self.rng.uniform(0.8, 1.0)), self.rng)
        if v["status"] == "charging":
            v["status"] = "healthy"
        prediction = self.repo.refresh_prediction(v)
        v["status"] = display_status(v, prediction)
        return prediction

    def state(self) -> dict[str, Any]:
        return {"running": self.running, "speed": self.speed, "seq": self.seq, "tick_seconds": config.TICK_SECONDS,
                "sim_seconds_per_tick": config.SIM_SECONDS_PER_TICK, "clients": len(self.clients)}

    # -- websocket ---------------------------------------------------------
    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.clients.add(ws)
        await ws.send_json({"type": "hello", "state": self.state(), "summary": dashboard_service.summary(self.repo, self)})

    def disconnect(self, ws: WebSocket) -> None:
        self.clients.discard(ws)

    async def broadcast(self, payload: dict[str, Any]) -> None:
        for ws in list(self.clients):
            try:
                await ws.send_json(payload)
            except Exception:
                self.clients.discard(ws)
