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

DISCLAIMER = (
    "Independent technology demonstration using synthetic data. "
    "Not an official VinFast product."
)
