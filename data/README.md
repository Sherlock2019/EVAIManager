# data/

Everything in this folder is **synthetic** and is generated automatically the
first time the backend starts (or with `python scripts/generate_telemetry.py --regenerate`).
The same seed always produces the same world.

| Path | Contents |
|---|---|
| `mobility_lab.db` | SQLite application database: vehicles, chargers, ADAS frames, reviews, service bookings, dataset versions |
| `generated/vehicles.csv` | 1,250 simulated EVs with telemetry fields |
| `generated/chargers.csv` | 186 charging stations |
| `generated/adas_frames.csv` | 5,000 mock driving frames with simulated detections |
| `generated/routes.json` | Route polylines and trip density |
| `generated/datasets.json` | Training dataset versions |
| `generated/candidate_sites.json`, `planned_sites.json` | Inputs to the charger planning engine |

Delete `mobility_lab.db` (or press **Reset synthetic world** in Simulation
Controls) to start again from a clean world.
