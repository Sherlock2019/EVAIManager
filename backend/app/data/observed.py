"""Observed (real) charging-station locations from free, open sources.

- OpenStreetMap, via the Overpass API (no key). Data (c) OpenStreetMap contributors, ODbL.
- Open Charge Map, only when OCM_API_KEY is set (free key at openchargemap.org). Open data, CC BY-SA 4.0.

Raw source records are cached in DATA_DIR. When there is no cache (first start,
no network), a snapshot bundled with the code is used so the demo works offline.
"""
from __future__ import annotations

import json
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app import config

SNAPSHOT = Path(__file__).with_name("observed_snapshot.json")
USER_AGENT = "EVAIManager-demo/1.0 (independent demo; github.com/Sherlock2019/EVAIManager)"
TIMEOUT_S = 180

OVERPASS_QUERY = """[out:json][timeout:170];
area["ISO3166-1"="VN"][admin_level=2]->.vn;
(node["amenity"="charging_station"](area.vn);way["amenity"="charging_station"](area.vn););
out center tags;"""

OCM_URL = "https://api.openchargemap.io/v3/poi/?output=json&countrycode=VN&maxresults=5000&compact=false&verbose=false"


def _get(url: str, data: bytes | None = None, headers: dict[str, str] | None = None) -> Any:
    req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT, **(headers or {})})
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
        return json.loads(r.read())


def fetch_osm() -> list[dict[str, Any]]:
    """Try each configured Overpass server in turn; raise the last error if all fail."""
    body = urllib.parse.urlencode({"data": OVERPASS_QUERY}).encode()
    error: Exception | None = None
    for url in config.OVERPASS_URLS:
        try:
            return _get(url.strip(), data=body)["elements"]
        except Exception as e:
            error = e
    raise RuntimeError(f"all Overpass servers failed: {error}")


def fetch_ocm(key: str) -> list[dict[str, Any]]:
    return _get(OCM_URL, headers={"X-API-Key": key})


def fetch_all() -> dict[str, Any]:
    """Fetch both sources. A failing source is reported in `errors`; the other one still counts."""
    raw: dict[str, Any] = {"fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "osm": [], "ocm": [], "errors": {}}
    try:
        raw["osm"] = fetch_osm()
    except Exception as e:  # network, rate limit or parse error: keep going with what we have
        raw["errors"]["osm"] = str(e)
    if config.OCM_API_KEY:
        try:
            raw["ocm"] = fetch_ocm(config.OCM_API_KEY)
        except Exception as e:
            raw["errors"]["ocm"] = str(e)
    else:
        raw["errors"]["ocm"] = "not configured: set OCM_API_KEY (free at openchargemap.org) to add Open Charge Map entries"
    return raw


def save(raw: dict[str, Any], path: Path | None = None) -> None:
    path = path or config.OBSERVED_CACHE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")


def load() -> dict[str, Any]:
    """Cached live fetch if present, else the bundled snapshot, else empty."""
    for path, origin in ((config.OBSERVED_CACHE, "cache"), (SNAPSHOT, "bundled snapshot")):
        if path.exists():
            raw = json.loads(path.read_text(encoding="utf-8"))
            raw["origin"] = origin
            return raw
    return {"fetched_at": None, "osm": [], "ocm": [], "errors": {"osm": "no data yet"}, "origin": "none"}
