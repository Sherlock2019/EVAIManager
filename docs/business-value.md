# Business Value

> The figures in the demo are synthetic. This page describes the kind of value each loop targets and how it would be measured with real data — it does not claim measured results.

## Four value areas

### ADAS data

- **Reduce manual labeling work.** High-confidence labels are accepted automatically; people only see what the model is unsure about.
- **Prioritize difficult samples.** The review queue is ordered by confidence, and edge-case mining directs data collection to the weakest scenarios.
- **Improve dataset quality.** Low-confidence labels cannot enter training without a human decision, and every correction is kept with its original AI label for audit.

*In the demo:* of 5,000 frames, about a quarter enter the review queue and the rest are accepted automatically; roughly 93% of individual object labels need no human action.

### Vehicle operations

- **Predict failures earlier.** Component risk is scored continuously from telemetry instead of at fixed service intervals.
- **Improve fleet availability.** A vehicle is serviced inside its predicted window rather than after a breakdown.
- **Optimize maintenance scheduling.** Predictions become a workshop plan grouped by severity, location, parts and duration.

*In the demo:* 23 of 1,250 vehicles are predicted to need maintenance, each with a component, a service window and reason codes.

### Charging network

- **Understand real charging demand.** Route density and session data replace static planning assumptions.
- **Identify infrastructure gaps.** Candidate sites are scored on demand, distance to the nearest fast charger and growth.
- **Avoid unnecessary capacity.** Planned sites are tested against observed demand; the engine recommends against building where utilization is low.

*In the demo:* +7 new stations and +22 ports recommended, while 3 planned sites are flagged as unnecessary (illustrative avoided investment of about $1.05M, a mock estimate).

### Continuous AI

- **Every vehicle generates learning data.**
- **Every correction improves models.**
- **Every journey improves network planning.**

The three loops share one fleet and one data platform, so each additional vehicle improves all three.

## How value would be measured with real data

| Area | Metric | Baseline to compare against |
|---|---|---|
| Labeling | Human labeling hours per 1,000 frames | Fully manual labeling |
| Labeling | Label error rate on an audited sample | AI-only labeling |
| ADAS | Recall on mined edge-case sets, per model version | Previous model version |
| Maintenance | Share of failures predicted at least N days ahead | Reactive service records |
| Maintenance | Unplanned downtime per vehicle per year | Fixed-interval servicing |
| Charging | Utilization of new sites 6 months after opening | Sites chosen by the static plan |
| Charging | Queue time at peak hours | Before expansion |
| Charging | Capital not spent on sites below a utilization threshold | The static expansion plan |

## Why the "do not build" recommendation matters

A planning tool that only ever recommends more capacity cannot be trusted with a budget. Showing that the same engine that says **ADD — Thu Duc East** also says **DO NOT EXPAND — District 7 West** demonstrates that its recommendations follow demand in both directions.

## Why the human stays in the loop

In each loop the AI proposes and a person disposes at the point where a mistake is expensive:

| Loop | AI proposes | Human decides |
|---|---|---|
| ADAS | A label and its confidence | Whether a doubtful label enters training |
| Vehicle | A component, a probability, a service window | Whether and when to book service |
| Charging | Sites to add, expand or drop | Where capital is committed |

That boundary is what makes the automation safe to scale.
