# POC 2 — EV Fleet, Predictive Maintenance & Charging Intelligence

> Synthetic fleet, stations and routes. Fictional vehicle IDs. Monetary values are illustrative mock estimates.

## The problem

Vehicle fleets continuously produce operational data. Instead of waiting for failures, AI can use it to predict maintenance, monitor fleet health, optimize charging, understand mobility patterns and plan charging infrastructure.

Two workflows run side by side on the same fleet:

```
EV TELEMETRY                          GPS / ROUTE HISTORY
     ↓                                       ↓
IoT INGESTION                          TRAVEL DEMAND
     ↓                                       ↓
VEHICLE DIGITAL HEALTH PROFILE         CHARGING BEHAVIOR
     ↓                                       ↓
AI ANOMALY DETECTION                   GEOSPATIAL ANALYTICS
     ↓                                       ↓
PREDICTIVE MAINTENANCE                 DEMAND FORECAST
     ↓                                       ↓
SERVICE SCHEDULING                     CHARGER SITE OPTIMIZATION
```

## Part A — Vehicle health

### The fleet — `backend/app/data/generator.py`

1,250 vehicles, `VF-EV-0001` to `VF-EV-1250`, across Ho Chi Minh City, Hanoi, Da Nang, Hai Phong and Nha Trang; models VF 3, 5, 6, 7, 8 and 9. Each has battery SOC and SOH, battery and motor temperature, odometer, daily distance, charging cycles, average efficiency, four tire pressures, fault codes, service dates, health score and maintenance risk.

About 5% of the fleet is generated with an injected issue (cooling, tire, battery, motor, brakes or charging) at medium, high or critical severity.

### Predictive maintenance engine — `maintenance_engine.py`

A deliberately simple, interpretable scoring model. Each component gets a 0–1 risk from telemetry:

| Component | Feature | Risk reaches 1.0 at |
|---|---|---|
| Battery cooling | Battery temperature above 37 °C | 49 °C |
| Battery pack | State of health below 90% | 80% |
| Tire | Lowest pressure below 2.32 bar | 1.90 bar |
| Drive motor | Motor temperature above 78 °C | 104 °C |
| Brakes | Distance since service above 18,000 km | 32,000 km |
| Charging | Charge cycles versus expected for odometer above 1.25× | 1.85× |

A matching fault code adds a little to its component.

```
maintenance_probability = 82 × worst component risk
                        + 12 × second-worst component risk
                        +  3 × odometer wear
                        +  3 × anomaly score        (IsolationForest over fleet telemetry)
```

| Probability | Risk |
|---|---|
| 0–30% | LOW |
| 31–60% | MEDIUM |
| 61–80% | HIGH |
| 81–100% | CRITICAL |

Outputs: `maintenance_probability`, `predicted_component`, `predicted_days_to_service`, `reason_codes`.

Example from the generated fleet:

```
Vehicle    VF-EV-0821 (VF 8)
Risk       87%  CRITICAL
Component  Battery Cooling System
Service    within 3 days
Reasons    + sustained high battery temperature (51°C)
           + increased charging frequency
           + abnormal efficiency decline (+17% Wh/km)
           + fault code BMS-T01: battery thermal limit warning
```

### Vehicle digital twin — *Vehicle Health* page

A top-view EV with live battery, motor, tire and odometer readouts; the AI health score; the predicted issue with confidence and service window; and **SCHEDULE MAINTENANCE**. Below it, seven subsystem profiles — Battery, Powertrain, Tires, Brakes, Thermal, Charging, Driving Usage — each with a health score, trend, risk and prediction.

### Maintenance control center — `service_scheduler.py`

A ranked table of predictions, and **Optimize Service Schedule**, a greedy planner that groups vehicles by:

1. **severity** — most urgent first; critical vehicles are pulled in the same day
2. **location** and **available service center** — nearest center in the vehicle's city
3. **parts availability** — jobs wait for parts lead time
4. **estimated service duration** — placed on the earliest day with free bay-hours

## Part B — Charging intelligence

### The network

186 charging stations. Map pins encode state:

| Colour | Meaning |
|---|---|
| Green | Normal capacity |
| Yellow | High usage (70–85%) |
| Red | Overloaded (> 85%) |
| Gray | Low utilization (< 30%) |
| Blue diamond | Recommended future charger |

Clicking a station shows chargers, availability, utilization, daily sessions, peak window, 90-day forecast and the AI recommendation.

### Routes and density — `route_analyzer.py`

Named commuter routes through HCMC districts (for example District 1 → Thu Duc → Di An), routes in the other cities and inter-city corridors. Vehicles on routes move live. Three heatmap layers: **travel density**, **charging demand**, **charger capacity**. Any vehicle's trip can be replayed with a timeline (started, traffic, charging, departed, destination) while SOC, speed, energy use and position update.

### Charger planning engine — `charger_optimizer.py`

```
site_score = 0.30 × route_density
           + 0.25 × charging_demand
           + 0.20 × distance_gap          (distance to nearest fast charger, capped at 8 km)
           + 0.15 × predicted_EV_growth
           + 0.10 × accessibility         → normalized 0–100
```

A site is recommended at 72 or above.

| # | Site | AI score | Expected sessions/day |
|---|---|---|---|
| 1 | Thu Duc East | 94 | ~310 |
| 2 | Nha Be North | 89 | ~280 |
| 3 | Di An South | 86 | ~260 |

### It also says no

The engine does not always recommend building more. Every existing station gets one of **EXPAND**, **MONITOR**, **KEEP** or **REDUCE PLANNED CAPACITY**, and every site in the (fictional) static expansion plan is tested against observed demand:

```
District 7 West
  Utilization              18%
  Nearby capacity          62 chargers
  Predicted demand growth  4%
  Recommendation           DO NOT EXPAND
  Estimated avoided investment: $420,000   (illustrative mock estimate)
```

### What-if simulator

Four sliders — projected EV growth, average daily distance, fast-charging adoption, peak-hour concentration — rescale demand and re-run the engine. At the calibrated baseline:

```
CURRENT NETWORK     186 stations
AI RECOMMENDATION   +7 new stations
                    +22 charger ports at existing stations
                    3 planned sites unnecessary
```

## The killer demo

Open **Charging Network** and press **AI Optimize Network**. The map changes:

- **ADD — Thu Duc East**: AI score 94, about 310 sessions/day expected
- **EXPAND — Thu Duc Tech Park Station**: 91% utilization, projected above 100%
- **DO NOT EXPAND — District 7 West**: 18% utilization, potential CAPEX avoided $420K*

That single screen shows AI, IoT, data engineering, geospatial analytics, prediction and cost thinking together.

## What is simulated, precisely

| Element | Reality in this demo |
|---|---|
| Telemetry | Generated, with live noise from the simulator |
| Maintenance model | Transparent scoring calibrated on the synthetic fleet, not trained on service history |
| Anomaly score | A real scikit-learn IsolationForest, fitted on the synthetic fleet |
| Route geometry | Smoothed lines between district centres, not road-snapped |
| Candidate-site features | Authored values; the scoring formula and what-if recalculation are real |
| Cost figures | Illustrative: planned ports × a flat mock cost per port |
