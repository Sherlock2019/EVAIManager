# VINFAST AI MOBILITY INTELLIGENCE LAB

Two practical AI concepts demonstrating how vehicle data can become a continuously improving intelligence platform.

**POC 1:** ADAS Human-in-the-Loop Learning Platform

**POC 2:** EV Fleet Health & Charging Intelligence Platform

> **This project is an independent technology demonstration created using synthetic data. It is not an official VinFast product.**
> No VinFast APIs, telemetry or datasets are used. The "models" are simulations of how such models behave, not production autonomous-driving models.

**Drive → Observe → Learn → Predict → Optimize → Improve**

![Executive overview](docs/screenshots/overview.png)

---

## Problem

**ADAS.** Driver-assistance systems need enormous amounts of accurately labeled data. Manual labeling is slow, expensive and hard to scale. AI-only labeling has the opposite problem: wrong labels silently enter the training set.

**Fleet and charging.** A connected fleet produces operational data all day, but most of it is only looked at after something breaks. Charger locations are often decided from static planning assumptions rather than from where vehicles actually drive and charge.

## Solution

One fleet, three feedback loops:

| Loop | Data | AI | Human / decision | What comes back |
|---|---|---|---|---|
| **Safer ADAS** | Camera + LiDAR frames | Auto-labeling with confidence scoring | Low-confidence labels go to a reviewer | Corrections become the next training dataset |
| **Healthier vehicles** | Battery, motor, tire telemetry | Interpretable risk scoring + anomaly detection | Service is scheduled before failure | Outcomes refine the health model |
| **Smarter charging** | GPS routes, charging sessions | Demand forecast + site scoring | Planner adds, expands — or declines to build | New usage data validates the plan |

**Ride Demand 24h** builds on the charging loop for ride-hailing in Ho Chi Minh City. Simulated in-vehicle IoT signals (seat occupancy, door events, GPS, ride requests) feed a 24-hour zone forecast of passengers, EV supply and trips from origin to destination. Drivers see which zone to be in and when; the network team sees which stations are too small, too big or missing.

![Ride demand](docs/screenshots/ride-demand.png)

**Demand Forecast Model** is a real trained model: scikit-learn gradient-boosted trees (Poisson loss) fitted on 49 days of synthetic hourly ride history and scored on a held-out week against the naive "same hour last week" forecast. The page shows its error, predicted versus actual per zone, which features it relies on, and a what-if predictor (zone, day, hour, rain). The history is synthetic, so the scores describe how well it recovers the simulated patterns, not real-world accuracy.

![Demand forecast model](docs/screenshots/demand-model.png)

**In-app guide.** The Overview opens with what the app is for, the problems it solves and how to use each main feature. Every other page carries a collapsible bar with the same three things for that page.

The point is the system, not a single model: data creates intelligence, intelligence creates decisions, humans validate the important ones, actions create new data.

## Architecture

```
                     ┌──────────────┐
                     │   EV FLEET   │
                     └──────┬───────┘
          ┌─────────────────┼─────────────────┐
          ↓                 ↓                 ↓
       ADAS DATA         TELEMETRY          ROUTES
          ↓                 ↓                 ↓
    AUTO LABELING      HEALTH AI       MOBILITY AI
          ↓                 ↓                 ↓
    HUMAN REVIEW       MAINTENANCE     CHARGER DEMAND
          ↓                 ↓                 ↓
       DATASET       SERVICE PLANNING  NETWORK OPTIMIZATION
          └─────────────────┼─────────────────┘
                            ↓
                   CONTINUOUS LEARNING
                            ↓
                    BETTER EV ECOSYSTEM
```

What actually runs in this repository:

```
 Browser ──HTTP/WebSocket──▶ nginx (dashboard) ──/api, /ws──▶ FastAPI
 React + TS + Tailwind                                         │
 Leaflet · Recharts                       routers ─▶ services ─▶ repository ─▶ SQLite
                                                       │                        + CSV/JSON
                                    live simulation tick (every 3 s)
```

- **Routers** (`backend/app/routers`) are thin HTTP handlers.
- **Services** (`backend/app/services`) hold all logic: auto-label engine, edge-case miner, maintenance engine, charger optimizer, route analyzer, service scheduler, live simulator, copilot.
- **Repository** (`backend/app/data`) is the only data-access layer: generates the synthetic world, persists it to SQLite, exports CSV/JSON.

More detail: [docs/architecture.md](docs/architecture.md) · [docs/adas-workflow.md](docs/adas-workflow.md) · [docs/fleet-ai-workflow.md](docs/fleet-ai-workflow.md)

## Screenshots

| | |
|---|---|
| ![Charging network](docs/screenshots/charging-network.png) **Charging Network** — AI Optimize: add, expand, do not expand | ![Human review](docs/screenshots/human-review.png) **Human Review** — correct a low-confidence label |
| ![Vehicle health](docs/screenshots/vehicle-health.png) **Vehicle Health** — telemetry, prediction, reason codes | ![Fleet command](docs/screenshots/fleet-command.png) **Fleet Command** — live fleet and trip replay |
| ![Edge cases](docs/screenshots/edge-cases.png) **Edge Case Miner** — where the model is likely to fail | ![Model metrics](docs/screenshots/model-metrics.png) **Model Metrics** — v5 vs v6 (mock) |
| ![Maintenance](docs/screenshots/maintenance.png) **Maintenance** — ranked predictions, schedule optimizer | ![Guided demo](docs/screenshots/guided-demo.png) **RUN AI DEMO** — 11 steps across all three loops |

All screenshots are in [docs/screenshots](docs/screenshots).

## Technology

| Layer | Stack |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, Recharts, Leaflet + OpenStreetMap, Lucide icons, Zustand |
| Backend | Python 3.11+, FastAPI, Pydantic v2, pandas, numpy, scikit-learn (IsolationForest) |
| Data | SQLite for application data; CSV/JSON for generated source datasets (`data/`) |
| Live updates | WebSocket (`/ws/live`) with HTTP polling fallback |
| Deployment | Dockerfile per service, `docker-compose.yml`, optional Kubernetes examples |

No GPU, no external LLM and no API keys are required.

## How to run

### Launcher (local machine or AWS EC2)

```bash
./start.sh            # Docker if it is usable, otherwise a Python venv + the built dashboard
./start.sh native     # force the no-Docker path (needs Python 3.11+ and Node 20+)
./start.sh status     # what is running, and the URLs
./start.sh stop
```

Both services listen on `0.0.0.0` and the script prints the URLs with the machine's public IP. On EC2, allow inbound TCP 9063 in the security group, then open `http://<public-ip>:9063`. Port 8000 is only needed for the API docs. The services keep running after you log out of SSH; logs are in `.run/`.

### Docker (one command)

```bash
docker compose up --build
```

- Dashboard: <http://localhost:9063>
- API docs: <http://localhost:8000/api/docs>

The first start generates the synthetic world (a few seconds) and writes it to `./data`. Ports and world size can be changed by copying `.env.example` to `.env`.

### Development mode

Two terminals. Requires Python 3.11+ and Node 20+.

```bash
# 1 — backend on :8000
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 2 — frontend on :5173 (proxies /api and /ws to :8000)
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>.

### Tests and tools

```bash
cd backend && pip install -r requirements-dev.txt && pytest          # engine + API tests
cd frontend && npm run build                                         # typecheck + production build
python scripts/generate_telemetry.py --stream --ticks 5              # print telemetry events as JSON lines
python scripts/generate_telemetry.py --regenerate                    # rebuild datasets from the seed
```

The map needs internet access for OpenStreetMap tiles; everything else works offline.

## Demo walkthrough

Press **RUN AI DEMO** (top right). Eleven steps run in sequence, each one a real state change in the backend, while the dashboards follow along:

1. New vehicle telemetry arrives
2. EV develops a battery temperature anomaly
3. Maintenance AI detects the anomaly
4. Service recommendation is generated
5. The vehicle's route feeds the charging-demand model
6. Charger demand prediction changes
7. AI proposes charging capacity expansion
8. An ADAS low-confidence frame is detected
9. A human corrects the motorcycle label
10. The frame enters the next training dataset
11. Updated model metrics appear

Then try the two centrepieces by hand:

- **Charging Network → AI Optimize Network.** The map changes: blue diamonds are new sites (Thu Duc East scores 94), `+` marks stations to expand, `✕` marks planned sites the model advises *against*. Move the what-if sliders and watch the plan recalculate.
- **Human Review.** Pick the selected motorcycle label, press **CORRECT**, change class or box, save. The correction lands in Dataset v24 and the simulated next model candidate moves on the Model Metrics page.

A spoken script for a 2-minute walkthrough is in [docs/demo-script.md](docs/demo-script.md).

## API

Interactive documentation: `/api/docs`.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/dashboard/summary` | Executive KPIs |
| GET | `/api/dashboard/insights` | AI insight feed |
| GET | `/api/vehicles` | Fleet list (filter by city, status, risk, search; paginated) |
| GET | `/api/vehicles/map` | Compact whole-fleet payload for maps |
| GET | `/api/vehicles/{id}` | Vehicle, prediction, digital twin |
| GET | `/api/vehicles/{id}/telemetry` | Recent telemetry history |
| GET | `/api/vehicles/{id}/route` | Today's trip, timeline, replay samples |
| GET | `/api/maintenance/predictions` | Ranked maintenance predictions |
| POST | `/api/maintenance/optimize-schedule` | Group vehicles into a service plan |
| POST | `/api/maintenance/schedule/{id}` | Book service for a vehicle |
| GET | `/api/chargers` | Stations with availability and recommendation |
| GET | `/api/chargers/recommendations` | Planning engine; query params are the what-if sliders |
| GET | `/api/routes`, `/api/routes/heatmap` | Routes and density layers |
| GET | `/api/rides/forecast` | 24-hour passenger demand, EV supply, trip flows, driver moves and charger sizing (`day=weekday\|weekend`) |
| GET | `/api/rides/model` | Trained demand model: scores versus baseline, feature importance, test-week predictions |
| GET | `/api/rides/model/predict` | What-if forecast for one zone and hour (`zone`, `hour`, `day_of_week`, `rain`) |
| GET | `/api/adas/frames`, `/api/adas/frames/{id}` | Frames with simulated detections |
| GET | `/api/adas/pipeline` | Auto-label routing statistics |
| GET | `/api/adas/review-queue` | Frames awaiting a human |
| POST | `/api/adas/review/{frame_id}` | Accept, correct, reject or add an object |
| GET | `/api/adas/edge-cases` | Edge-case mining report |
| GET | `/api/adas/model-metrics` | Model dashboard data (mock) |
| GET | `/api/datasets` | Training dataset versions |
| POST | `/api/copilot/ask` | Deterministic copilot |
| POST | `/api/demo/step/{n}` | One step of the guided demo |
| GET/POST | `/api/sim/state`, `/control`, `/inject`, `/reset` | Simulation controls |
| WS | `/ws/live` | Live simulation deltas |

## Future production architecture

What would replace each demo component:

| In this demo | In production |
|---|---|
| Simulation tick + WebSocket | Vehicle gateway, MQTT / event streaming (Kafka) over 5G / WiFi |
| SQLite + CSV/JSON | Object storage for camera/LiDAR, telemetry store, data lake, feature store, relational DB |
| Rule-based confidence simulation | Real perception model inference on GPU, with calibrated confidence |
| Weighted risk score + IsolationForest | Per-component models trained on service history; survival analysis for time-to-service |
| Authored demand features | Demand forecasting from trip and session history; real road-network routing |
| Dataset version records | Dataset versioning (DVC/lakeFS), experiment tracking, model registry, CI/CD for models |
| One FastAPI process | One stateless service per engine on Kubernetes, GPU and CPU node pools |
| Deterministic copilot | LLM with retrieval over the same APIs, with guardrails |

Kubernetes examples: [deployment/k8s](deployment/k8s).

## Limitations

- **Everything is synthetic.** Vehicles, telemetry, stations, routes, frames, metrics and monetary values are generated from a seed. Dollar figures are illustrative mock estimates.
- **No real perception.** The auto-label engine assigns confidences by rule; camera frames are drawn scenes, not images. Model metrics are authored numbers, and the "next candidate" uplift is a mock constant per correction.
- **Edge-case error rates are derived from confidence**, not from audited ground truth.
- **Routes are not snapped to roads.** They are smoothed lines between district centres, and vehicles can appear to drive through buildings or water.
- **The ride demand forecast is a zone model, not a trained network.** Hourly profiles per zone type, a gravity model for trips and a rule for where idle EVs wait; no real passenger, sensor or ride-hailing data. It covers Ho Chi Minh City only, and its charger sizing looks at today's busiest hour, so it differs from the 90-day plan on the Charging Network page.
- **The maintenance model is a transparent scoring function**, calibrated on the synthetic fleet, not trained on service records.
- **Single process, in-memory simulation.** Not built for concurrency or scale; SQLite persistence covers reviews, bookings and dataset counts only.
- **Kubernetes manifests are examples** and were not run against a cluster.
- Files written to `./data` by Docker are owned by root; delete the folder (or `chown` it) before switching to development mode on Linux.

## Repository layout

```
backend/     FastAPI app: routers, services, schemas, data layer, tests
frontend/    React dashboard: pages, components, map and live-data libraries
data/        Generated SQLite database and CSV/JSON datasets (created on first run)
scripts/     generate_telemetry.py — dataset generation and telemetry stream
docs/        Architecture, workflows, demo script, business value, screenshots
deployment/  Optional Kubernetes examples
```
