# Demo Script

Two versions: a 2-minute walkthrough and a 5-minute version with more hands-on moments. Both assume the app is already open on the **Overview** page.

Say once, early: *"Everything here is synthetic data and simulated models — it is my own demonstration, not a VinFast product."*

---

## 2-MINUTE VERSION

Four screens, in this order: **Overview → Human Review → Vehicle Health → Charging Network**.

### Start — Overview (0:00)

> "Instead of showing only an AI model, I wanted to demonstrate how AI can become part of the complete vehicle lifecycle."

Point at the map: 1,248 simulated EVs, live.

### ADAS — Human Review (0:15)

> "A vehicle generates camera and LiDAR data.
>
> AI labels high-confidence observations automatically.
>
> Low-confidence cases go to humans.
>
> Human corrections become training data.
>
> The next model therefore learns directly from production edge cases."

While speaking: the motorcycle label is already selected. Press **CORRECT**, then **Save correction**. The console answers *"Correction will be added to Dataset v24."*

### EV — Vehicle Health (0:50)

> "The same idea can apply to the vehicle itself.
>
> Telemetry allows AI to monitor vehicle health and predict maintenance."

Open vehicle `0821`: 87% risk, battery cooling system, service within 3 days, with the reasons listed.

### MAP — Charging Network (1:15)

> "Vehicle journeys also tell us where charging demand actually exists.
>
> Instead of deciding charger locations only from static planning assumptions, AI can learn from real mobility patterns."

Press **AI Optimize Network**. Point at one site it adds (Thu Duc East, 94) and one it advises **not** to build (District 7 West).

### Finish (1:45)

> "One fleet therefore creates three feedback loops:
>
> safer ADAS,
> healthier vehicles,
> and a smarter charging network."

### Hands-free alternative

Press **RUN AI DEMO** instead and narrate over it. It takes about 40 seconds and moves the dashboards for you. Its eleven steps run in the order **vehicle → charging → ADAS**, so say the EV and MAP paragraphs before the ADAS one.

---
## 5-MINUTE VERSION

| Time | Screen | Do | Say |
|---|---|---|---|
| 0:00 | Overview | Let the map run. Click **HCMC**. | "This is one fleet, 1,250 simulated vehicles. Everything you see is driven by a live simulator." |
| 0:30 | Charging Network | Press **AI Optimize Network**. | "Journeys show where demand really is. The planner scores new sites — Thu Duc East gets 94." |
| 1:00 | Charging Network | Click **District 7 West** in *Excess Capacity Check*. | "And it says no. 18% utilization, 62 chargers nearby — do not expand. That is about $420K of illustrative CAPEX avoided." |
| 1:30 | Charging Network | Drag **Projected EV growth** to 80%. | "It is a model, not a slide: change the assumption and the plan recalculates." |
| 2:00 | Human Review | Select the motorcycle, **CORRECT**, save. | "The model was 51% sure about this motorcycle in heavy rain, so a person decides. That correction goes into Dataset v24." |
| 2:45 | Edge Cases | Point at the top row. | "The system finds where it is weakest and asks for exactly that data: 2,500 more night-rain motorcycle frames." |
| 3:15 | Vehicle Health | Open `0821`. | "87% maintenance risk, battery cooling, three days — with the reasons. Interpretable on purpose." |
| 3:45 | Maintenance | **Optimize Service Schedule**. | "Predictions become a workshop plan: grouped by severity, location, parts and duration." |
| 4:15 | Architecture | Scroll the layers. | "The demo is one process. Each service is already a separate module, so in production each becomes its own deployment — GPU for inference and training, CPU for the rest." |
| 4:45 | Architecture | Point at the philosophy panel. | "Data creates intelligence, intelligence creates decisions, humans validate the important ones, and actions create new data." |

---

## Likely questions

**"Is the perception model real?"**
No. Confidence is rule-based so the workflow can be shown without proprietary data. The routing, review, versioning and mining logic around it is real code. With a real model, only the confidence source changes.

**"Why not train a model for maintenance?"**
On synthetic data a trained model would just learn the generator. An interpretable score shows the product behaviour — reason codes, risk bands, service windows. In production I would train per-component models on service history and keep the reason codes.

**"How would this scale?"**
Replace the simulator with the vehicle gateway and an event stream, move state to a telemetry store and a relational database, and deploy each service separately on Kubernetes. See `docs/architecture.md` and `deployment/k8s/production-topology.yaml`.

**"Where do the numbers come from?"**
A seeded generator. The KPIs on screen are computed from the generated data by the same services the API exposes; the model metrics are authored and labelled as mock.

**"What would you build next?"**
Road-snapped routing, a real small detector on an open driving dataset for the labeling loop, and a demand forecast trained on session history instead of authored features.

---

## Before a live demo

- Start the stack a few minutes early; the first start generates the data.
- Open **Simulation Controls → Reset synthetic world** for a clean state.
- The map needs internet for OpenStreetMap tiles.
- Use a window at least 1,600 px wide so the demo panel sits beside the dashboards.
