"""Runtime configuration, read from the environment with sensible local defaults."""
from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

DATA_DIR = Path(os.getenv("DATA_DIR", REPO_ROOT / "data"))
GENERATED_DIR = DATA_DIR / "generated"
DB_PATH = DATA_DIR / "mobility_lab.db"

SEED = int(os.getenv("SIM_SEED", "42"))
TICK_SECONDS = float(os.getenv("SIM_TICK_SECONDS", "3"))
# One tick represents this many seconds of simulated driving (time-lapse).
SIM_SECONDS_PER_TICK = float(os.getenv("SIM_SECONDS_PER_TICK", "60"))
FLEET_SIZE = int(os.getenv("FLEET_SIZE", "1250"))
FRAME_COUNT = int(os.getenv("ADAS_FRAME_COUNT", "5000"))
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")

# Observed (real) charging-station locations: OpenStreetMap via Overpass, plus Open Charge Map when a free key is set.
# comma-separated; tried in order (public Overpass servers are often busy)
OVERPASS_URLS = os.getenv("OVERPASS_URLS", "https://overpass-api.de/api/interpreter,https://overpass.private.coffee/api/interpreter,https://overpass.kumi.systems/api/interpreter").split(",")
OCM_API_KEY = os.getenv("OCM_API_KEY", "")
OBSERVED_CACHE = DATA_DIR / "observed_chargers.json"

DISCLAIMER = (
    "Independent technology demonstration using synthetic data. "
    "Not an official VinFast product."
)
