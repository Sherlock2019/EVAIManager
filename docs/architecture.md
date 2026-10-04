# Architecture

> Independent technology demonstration on synthetic data. Not an official VinFast product.

The lab is built around one idea: **do not build an isolated AI model — build a system** in which data creates intelligence, intelligence creates decisions, humans validate the important decisions, actions create new data, and the whole thing improves continuously.

This document covers three things: the reference architecture the demo illustrates, what actually runs in this repository, and how one would grow into the other.

## 1. Reference architecture

Seven layers, vehicle to human. The right-hand column says what stands in for each layer in the demo.

| # | Layer | Production components | In this demo |
|---|---|---|---|
| 1 | **Vehicle** | Camera, LiDAR, GPS, Battery Management System, vehicle CAN / telemetry, IoT sensors | Seeded generator for 1,250 EVs and 5,000 frames (`backend/app/data/generator.py`) |
| 2 | **Edge / connectivity** | Vehicle gateway, MQTT / event streaming, 5G / WiFi | Simulation tick every 3 s, pushed over WebSocket (`telemetry_service.py`) |
| 3 | **Data platform** | Object storage, telemetry store, data lake, feature store | SQLite + CSV/JSON under `data/` (`database.py`, `repository.py`) |
| 4 | **AI / ML** | Computer vision, auto-labeling, anomaly detection, predictive maintenance, demand forecasting, route intelligence | Python service layer; scikit-learn IsolationForest; rule-based simulations |
| 5 | **MLOps** | Dataset versioning, experiment tracking, model registry, CI/CD, model deployment, monitoring | Dataset version records, edge-case miner, mock model dashboard |
| 6 | **Applications** | ADAS operations, fleet operations, service planning, charging optimization | The React dashboard and FastAPI REST API |
| 7 | **Human** | ADAS reviewer, fleet operator, engineer, service manager, network planner | Review console, schedule optimizer, what-if simulator |

The loop closes from layer 7 back to layer 3: a reviewer's correction, a booked service and a planning decision are all written back as data.

## 2. What runs in this repository

```
┌──────────────────────────── browser ────────────────────────────┐
│ React + TypeScript · Tailwind · Leaflet · Recharts · Zustand    │
│  pages/        15 screens                                       │
│  lib/live.ts   WebSocket client (polling fallback) → store      │
│  lib/map.ts    vehicle layer (canvas + clustering), heat layer  │
└───────────────┬─────────────────────────────────────────────────┘
        /api (REST)  /ws/live (WebSocket)
┌───────────────▼─────────────────────────────────────────────────┐
│ FastAPI                                                         │
│  routers/    dashboard · vehicles · maintenance · chargers ·    │
│              routes · adas · datasets · system                  │
│  services/   adas_label_engine     edge_case_engine             │
│              review_service        model_metrics                │
│              maintenance_engine    service_scheduler            │
│              charger_optimizer     route_analyzer               │
│              telemetry_service     dashboard_service            │
│              copilot               demo_orchestrator            │
│  schemas/    Pydantic request / response models                 │
│  data/       generator → database (SQLite) → repository         │
└───────────────┬─────────────────────────────────────────────────┘
          data/mobility_lab.db · data/generated/*.csv|json
```

### Layering rules

- **Routers** only translate HTTP to service calls. No business logic.
- **Services** contain every decision rule and are plain functions over plain dictionaries, which is why they are easy to unit-test (`backend/tests/test_engines.py`).
- **Repository** is the only module that touches storage. It loads the world into memory at start-up; mutations that must survive a restart (reviews, bookings, dataset counts) are written through to SQLite.

### Live data path

1. `LiveSimulation.tick()` advances the world by one simulated minute: route vehicles move along their polylines, others wander near home; batteries drain or charge; charger availability drifts toward each station's average utilization; one to three ADAS events are emitted.
2. The tick is serialized as a compact delta — `[index, lat, lon, soc, status, speed]` per changed vehicle — and broadcast to all WebSocket clients (about 25 KB per tick for the full fleet).
3. The browser applies the delta to an in-memory fleet table and nudges the map markers, interpolating between ticks so movement looks continuous. At low zoom the fleet is drawn as grid clusters; at city zoom every vehicle is a canvas marker.
4. If the WebSocket is unavailable the client polls `/api/live/tick`.

### Guided demo

`demo_orchestrator.py` does not play back a recording. Each of the eleven steps calls the same services the UI uses — it raises a battery temperature, re-runs the maintenance engine, books service, bumps a demand forecast, re-runs the optimizer, applies a human correction through `review_service` — and returns before/after values taken from the real results. Step 1 resets the entities it touches, so the demo is repeatable.

## 3. Cloud-native deployment view (conceptual)

```
                     ┌──────────────── Kubernetes ────────────────┐
 vehicles ──MQTT──▶  │ vehicle-ingestion-service                  │
                     │ adas-label-service          (GPU pool)     │
                     │ human-review-service                       │
                     │ fleet-health-service                       │
                     │ maintenance-prediction-service             │
                     │ charging-optimizer-service                 │
                     │ route-analysis-service                     │
                     │ api-gateway ── dashboard                   │
                     └───────┬─────────────────────┬──────────────┘
                             │                     │
                    object storage             database
                  camera · LiDAR ·        fleet · labels ·
                  model artifacts         maintenance · charging
```

| Workload | Runs on | Examples |
|---|---|---|
| GPU | GPU node pool | ADAS inference, model training |
| CPU | CPU node pool | ETL, APIs, telemetry processing, optimization |

Each file in `backend/app/services` corresponds to one of these services. In the demo they share a process; the boundaries between them are already function calls with explicit inputs and outputs, so splitting them is a deployment change rather than a redesign. `deployment/k8s/production-topology.yaml` sketches that split; `deployment/k8s/mobility-lab.yaml` is a runnable example of the two demo containers.

## 4. Design decisions

| Decision | Why |
|---|---|
| Interpretable scoring instead of a trained black box for maintenance | Every prediction must be explainable with reason codes; with synthetic data a trained model would only learn the generator. |
| The frame's confidence is its weakest label | A frame is safe to auto-accept only if every label in it is; one doubtful motorcycle is enough to need a human. |
| The optimizer can say "do not build" | A planning tool that only ever recommends more capacity is not doing planning. Planned sites are tested against observed demand. |
| One seed, deterministic world | The same numbers appear every run, which matters when a demo is rehearsed. |
| Deterministic copilot | Answers are computed from the same services as the dashboards, so they can never disagree with what is on screen, and no API key is needed. |
| Vehicle deltas, not full snapshots, over WebSocket | Keeps a 1,250-vehicle map smooth at a 3-second tick. |
