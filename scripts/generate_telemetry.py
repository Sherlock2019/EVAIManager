#!/usr/bin/env python3
"""Mock real-time telemetry simulator.

Stands in for the vehicle gateway / event stream of a real platform. It uses the
same simulation engine the API runs in-process, so what it prints is exactly
what the dashboard receives over WebSocket.

Examples
--------
Regenerate the synthetic datasets (SQLite + CSV/JSON under data/):

    python scripts/generate_telemetry.py --regenerate

Stream telemetry as JSON lines, one event per line, every 3 seconds:

    python scripts/generate_telemetry.py --stream
    python scripts/generate_telemetry.py --stream --interval 1 --ticks 20 --out data/generated/telemetry.jsonl

Everything is synthetic. No real vehicle data is read or produced.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any, Iterator, TextIO

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app import config  # noqa: E402
from app.data.repository import repo  # noqa: E402
from app.services.telemetry_service import STATUS_CODES, LiveSimulation  # noqa: E402

STATUS_NAMES = {code: name for name, code in STATUS_CODES.items()}


def events_from_tick(tick: dict[str, Any], sample: int) -> Iterator[dict[str, Any]]:
    """Flatten one simulation tick into individual telemetry events."""
    ts, seq = tick["ts"], tick["seq"]
    for idx, lat, lon, soc, status, speed in tick["positions"][:sample]:
        v = repo.vehicles[int(idx)]
        yield {
            "type": "vehicle.telemetry", "ts": ts, "seq": seq, "vehicle_id": v["vehicle_id"], "model": v["model"],
            "latitude": lat, "longitude": lon, "speed_kmh": speed, "battery_soc": soc,
            "battery_temperature": v["battery_temperature"], "motor_temperature": v["motor_temperature"],
            "status": STATUS_NAMES[int(status)],
        }
    for idx, available in tick["chargers"]:
        c = repo.chargers[int(idx)]
        yield {"type": "charger.availability", "ts": ts, "seq": seq, "station_id": c["station_id"], "name": c["name"],
               "ports": c["ports"], "available": available}
    for e in tick["adas_events"]:
        yield {"type": "adas.event", "ts": ts, "seq": seq, **e}


def stream(interval: float, ticks: int, sample: int, out: TextIO) -> None:
    repo.load()
    sim = LiveSimulation(repo)
    sim.prepare()
    n = 0
    try:
        while ticks <= 0 or n < ticks:
            tick = sim.tick()
            count = 0
            for event in events_from_tick(tick, sample):
                out.write(json.dumps(event) + "\n")
                count += 1
            out.flush()
            n += 1
            print(f"tick {tick['seq']:>4}  {len(tick['positions']):>4} vehicle updates  "
                  f"{len(tick['chargers'])} charger updates  {len(tick['adas_events'])} ADAS events  "
                  f"({count} events written)", file=sys.stderr)
            if ticks <= 0 or n < ticks:
                time.sleep(interval)
    except KeyboardInterrupt:
        print("stopped", file=sys.stderr)
    except BrokenPipeError:  # downstream reader (e.g. `| head`) went away
        sys.stderr.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Synthetic EV fleet telemetry simulator")
    parser.add_argument("--regenerate", action="store_true", help="rebuild the synthetic datasets from the seed")
    parser.add_argument("--stream", action="store_true", help="emit telemetry events as JSON lines")
    parser.add_argument("--interval", type=float, default=config.TICK_SECONDS, help="seconds between ticks (default %(default)s)")
    parser.add_argument("--ticks", type=int, default=0, help="stop after N ticks (default: run until Ctrl+C)")
    parser.add_argument("--sample", type=int, default=25, help="vehicle updates to print per tick (default %(default)s)")
    parser.add_argument("--out", type=Path, default=None, help="write events to this file instead of stdout")
    args = parser.parse_args()

    if not (args.regenerate or args.stream):
        parser.print_help()
        return
    if args.regenerate:
        repo.load(force_regenerate=True)
        print(f"Generated {len(repo.vehicles)} vehicles, {len(repo.chargers)} charging stations, "
              f"{len(repo.routes)} routes and {len(repo.frames)} ADAS frames in {config.DATA_DIR}", file=sys.stderr)
    if args.stream:
        if args.out:
            args.out.parent.mkdir(parents=True, exist_ok=True)
            with args.out.open("w", encoding="utf-8") as fh:
                stream(args.interval, args.ticks, args.sample, fh)
        else:
            stream(args.interval, args.ticks, args.sample, sys.stdout)


if __name__ == "__main__":
    main()
