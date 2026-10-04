# Roadmap: POC → MVP → production

> Independent technology demonstration on synthetic data. Not an official VinFast product.
> Everything below the "POC" row is a plan. None of it is built.

A stage is finished when its exit criteria are met, not when a date passes. Each stage answers one question; if the answer is no, the right move is to stop or change direction, not to continue to the next stage.

## Stages at a glance

| Stage | The question it answers | Data | Users | Runs on |
|---|---|---|---|---|
| **POC** (today) | Does the loop from data to decision make sense end to end? | Synthetic, seeded | Demo audience | One process, SQLite, a laptop or one EC2 instance |
| **MVP** | Does one loop help one real team make a better decision? | Real data for one city and one loop | One team, 5 to 20 people | One managed database, one API service, basic auth |
| **Pilot** | Does it keep working for weeks with nobody from the build team watching? | Live feeds, 2 to 3 loops | Several teams in one region | Kubernetes, streaming ingestion, on-call |
| **Production** | Can the business depend on it? | All regions, governed | All intended users | Multi-zone, SLOs, audited access |

## Stage 1: MVP

**Pick one loop.** Building all four on real data at once is how MVPs fail. The recommended first loop is **ride demand and charger sizing**: its inputs (trip records, charger session logs) are the easiest real data to obtain, it needs no safety case, and it has a number that shows whether it worked (forecast error against the naive baseline, which the POC already measures).

| Workstream | What to build | Replaces in the POC |
|---|---|---|
| Data | Ingest real trip and charging-session records for one city into PostgreSQL + PostGIS; a documented schema; nightly load | `generator.py`, SQLite |
| Model | Retrain the demand model on real history; keep the same held-out-week test and baseline; store each trained model with its scores | Synthetic history in `demand_model.py` |
| Backend | Repository backed by PostgreSQL; forecasts computed by a scheduled job and read from a table | In-memory world, training inside a request |
| Frontend | Ride Demand and Demand Forecast Model pages wired to real data; remove pages that still show mock data from the MVP build | Mock tags |
| Access | Single sign-on, two roles (viewer, planner), HTTPS | Open access on a port |
| Operations | One environment plus staging; CI deploys on merge; structured logs; uptime check | `start.sh` |

**Exit criteria**

- The model beats "same hour last week" on a held-out month of real data, and the margin is reported with the model.
- At least one real decision (a driver positioning plan or a station sizing change) was made using the tool, and the team says it would use it again.
- A new engineer can deploy to staging from the README in under an hour.
- No personal data is stored that the loop does not need; what is stored has an owner and a retention period.

## Stage 2: Pilot

| Workstream | What to build |
|---|---|
| Data | Streaming ingestion (vehicle gateway → MQTT or Kafka → time-series store); data-quality checks that block bad loads; a second loop's data (fleet telemetry for maintenance) |
| Models | Model registry; scheduled retraining; drift monitoring on inputs and on error; every model change evaluated in shadow before it serves users |
| Platform | Split the engines that need to scale differently into their own services; Redis for hot state; pub/sub fan-out for live updates |
| Reliability | SLOs defined and measured; on-call rotation; runbooks for the top failure modes; backups restored in a drill |
| Security | Threat model; secrets in a manager; dependency and container scanning in CI; audit log of who changed what |
| Product | Feedback captured in the tool (accepted, overridden, ignored) so recommendations can be scored against what people did |

**Exit criteria**

- Four consecutive weeks inside SLO with no build-team intervention outside the on-call process.
- A model was retrained, evaluated and promoted (or rejected) through the pipeline, not by hand.
- A restore from backup was performed and timed.
- Override rate on recommendations is measured, and the reasons are reviewed.

## Stage 3: Production

| Workstream | What to build |
|---|---|
| Scale | Multi-zone deployment; autoscaling; load tested at 3× expected peak; GPU pool if ADAS inference is in scope |
| ADAS loop | Real perception inference, calibrated confidence, labeling tool integration, dataset versioning (DVC or lakeFS). This loop has safety implications and needs its own validation plan before any label feeds training. |
| Governance | Data catalogue and lineage; access reviews; model cards and decision logs kept for audit; privacy impact assessment for location data |
| Cost | Per-service cost attribution; budgets and alerts; storage tiering for camera and LiDAR data |
| Change management | Canary releases with automatic rollback; feature flags; deprecation policy for APIs |
| Support | Tiered support model; user documentation; training for each role |

**Exit criteria**

- SLOs met for a full quarter, error budget policy applied at least once.
- Disaster recovery tested: region loss scenario, with measured recovery time and data loss.
- Security review and privacy review passed by the teams that own them.
- Every model in service has an owner, a retraining schedule, a monitor and a rollback.

## Risks to settle early

| Risk | Why it matters | When to resolve |
|---|---|---|
| Data access and ownership | Without real data there is no MVP; agreements take longer than code | Before MVP starts |
| Location data privacy | Trip origins and destinations identify people | MVP design |
| The POC's models learned a simulation | Scores on synthetic data say nothing about real accuracy | First week of MVP: retrain and re-measure |
| Recommendation trust | A forecast nobody acts on has no value | MVP: measure overrides, show reasons |
| ADAS label quality is safety-relevant | Wrong labels in training can cause harm | Before the ADAS loop leaves the lab |
| Scope creep across four loops | Each loop is a product | Hold to one loop per stage gate |

## What carries over from the POC

- The layering (routers → services → repository) and the test that enforces it. Swapping SQLite for PostgreSQL is a change inside `app/data`.
- Each engine's interface: plain inputs, plain outputs. They can be lifted into separate services unchanged.
- The model evaluation method: held-out period, naive baseline, error by condition.
- The UI and the in-app guide.

What does not carry over: the synthetic generator, the in-memory world, the single process, open access, and every number on screen.
