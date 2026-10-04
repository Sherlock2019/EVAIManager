"""SQLite persistence for application data, plus CSV/JSON exports of the
generated source datasets under data/generated/."""
from __future__ import annotations

import json
import sqlite3
from typing import Any

import pandas as pd

from app import config

JSON_COLUMNS = {
    "vehicles": ["fault_codes"],
    "chargers": [],
    "adas_frames": ["objects"],
}
BOOL_COLUMNS = {
    "vehicles": ["moving"],
    "chargers": ["fast"],
    "adas_frames": ["lidar_available", "review_required"],
}


def connect() -> sqlite3.Connection:
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def exists() -> bool:
    if not config.DB_PATH.exists():
        return False
    with connect() as conn:
        row = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='documents'").fetchone()
    return row is not None


def _frame(records: list[dict[str, Any]], table: str) -> pd.DataFrame:
    df = pd.DataFrame(records)
    for col in JSON_COLUMNS[table]:
        df[col] = df[col].map(json.dumps)
    return df


def save_world(world: dict[str, Any]) -> None:
    """Write the generated world to SQLite and export source datasets as CSV/JSON."""
    config.GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        for table, key in (("vehicles", "vehicles"), ("chargers", "chargers"), ("adas_frames", "frames")):
            df = _frame(world[key], table)
            df.to_sql(table, conn, if_exists="replace", index=False)
            df.to_csv(config.GENERATED_DIR / f"{table}.csv", index=False)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_frames_id ON adas_frames(frame_id)")
        conn.execute("DROP TABLE IF EXISTS documents")
        conn.execute("CREATE TABLE documents (key TEXT PRIMARY KEY, body TEXT NOT NULL)")
        for key in ("routes", "datasets", "candidate_sites", "planned_sites"):
            conn.execute("INSERT INTO documents VALUES (?, ?)", (key, json.dumps(world[key])))
            (config.GENERATED_DIR / f"{key}.json").write_text(json.dumps(world[key], indent=1), encoding="utf-8")
        conn.execute("DROP TABLE IF EXISTS reviews")
        conn.execute(
            "CREATE TABLE reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, frame_id TEXT, action TEXT, "
            "reviewer TEXT, detail TEXT, created_at TEXT)"
        )
        conn.execute("DROP TABLE IF EXISTS service_bookings")
        conn.execute(
            "CREATE TABLE service_bookings (id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id TEXT, "
            "component TEXT, service_center TEXT, scheduled_for TEXT, created_at TEXT)"
        )


def load_world() -> dict[str, Any]:
    world: dict[str, Any] = {}
    with connect() as conn:
        for table, key in (("vehicles", "vehicles"), ("chargers", "chargers"), ("adas_frames", "frames")):
            df = pd.read_sql(f"SELECT * FROM {table}", conn)
            for col in JSON_COLUMNS[table]:
                df[col] = df[col].map(json.loads)
            for col in BOOL_COLUMNS[table]:
                df[col] = df[col].astype(bool)
            df = df.astype(object).where(df.notna(), None)
            world[key] = df.to_dict("records")
        for row in conn.execute("SELECT key, body FROM documents"):
            world[row["key"]] = json.loads(row["body"])
        world["bookings"] = [dict(r) for r in conn.execute("SELECT * FROM service_bookings ORDER BY id")]
        world["reviews"] = [dict(r) for r in conn.execute("SELECT * FROM reviews ORDER BY id")]
    return world


def update_frame(frame: dict[str, Any]) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE adas_frames SET objects=?, objects_detected=?, model_confidence=?, label_status=?, "
            "review_required=?, dataset_version=? WHERE frame_id=?",
            (json.dumps(frame["objects"]), frame["objects_detected"], frame["model_confidence"], frame["label_status"],
             int(frame["review_required"]), frame["dataset_version"], frame["frame_id"]),
        )


def insert_review(frame_id: str, action: str, reviewer: str, detail: dict[str, Any], created_at: str) -> None:
    with connect() as conn:
        conn.execute(
            "INSERT INTO reviews (frame_id, action, reviewer, detail, created_at) VALUES (?, ?, ?, ?, ?)",
            (frame_id, action, reviewer, json.dumps(detail), created_at),
        )


def save_document(key: str, body: Any) -> None:
    with connect() as conn:
        conn.execute("INSERT OR REPLACE INTO documents VALUES (?, ?)", (key, json.dumps(body)))


def insert_booking(booking: dict[str, Any]) -> None:
    with connect() as conn:
        conn.execute(
            "INSERT INTO service_bookings (vehicle_id, component, service_center, scheduled_for, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (booking["vehicle_id"], booking["component"], booking["service_center"], booking["scheduled_for"], booking["created_at"]),
        )
