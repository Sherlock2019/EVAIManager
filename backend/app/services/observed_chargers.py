"""Observed (real) charging stations: normalise OpenStreetMap and Open Charge Map records.

OBSERVED DATA: locations and whatever the source tags say (operator, sockets,
power). There is no live status, price, utilization or revenue in these
sources; those stay simulated elsewhere in the app and are never attached here.

Rules:
- records whose name/operator describe power-grid infrastructure (substations,
  power plants) and not a charging operator are dropped as mis-tagged;
- brand = "vinfast" when name/operator/brand mention VinFast or V-Green,
  "other" when another operator is named, "unknown" when nothing is tagged;
- vehicle = "car" (motorcar tag or a car socket), "e-scooter" (moped/scooter
  only), else "unknown";
- OpenStreetMap is the base; an Open Charge Map entry is added only when no
  OpenStreetMap station lies within MERGE_RADIUS_M (it fills a gap).
"""
from __future__ import annotations

import math
import re
from typing import Any

MERGE_RADIUS_M = 75
POWER_INFRA = re.compile(r"\bTBA\b|\b\d+\s*kV\b|nhi[eệ]t đi[eệ]n|th[uủ]y đi[eệ]n|thuỷ điện|tr[aạ]m bi[eế]n [aá]p|cao th[eế]|substation|power plant", re.I)
VINFAST = re.compile(r"vin\s*fast|v[\s-]?green|vingroup", re.I)
CAR_SOCKETS = ("type2", "type2_combo", "chademo", "gb_dc", "gb_ac", "ccs", "tesla_supercharger", "type1", "type1_combo")
POWER_RE = re.compile(r"([\d.]+)\s*kW", re.I)

# region centres for grouping on the map (city, lat, lon); stations further than REGION_KM from all of them are "Other provinces"
REGIONS = [
    ("Ho Chi Minh City", 10.7769, 106.7009), ("Hanoi", 21.0285, 105.8342), ("Da Nang", 16.0544, 108.2022),
    ("Hai Phong", 20.8449, 106.6881), ("Nha Trang", 12.2388, 109.1967), ("Can Tho", 10.0452, 105.7469),
]
REGION_KM = 30


def _km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    dy = (lat2 - lat1) * 111.0
    dx = (lon2 - lon1) * 111.0 * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot(dx, dy)


def region(lat: float, lon: float) -> str:
    city, d = min(((c, _km(lat, lon, la, lo)) for c, la, lo in REGIONS), key=lambda x: x[1])
    return city if d <= REGION_KM else "Other provinces"


def _brand(text: str) -> str:
    if VINFAST.search(text):
        return "vinfast"
    return "other" if text.strip() else "unknown"


def normalize_osm(el: dict[str, Any]) -> dict[str, Any] | None:
    tags = el.get("tags", {})
    lat = el.get("lat", el.get("center", {}).get("lat"))
    lon = el.get("lon", el.get("center", {}).get("lon"))
    if lat is None or lon is None:
        return None
    text = " ".join(tags.get(k, "") for k in ("name", "operator", "brand", "network"))
    if POWER_INFRA.search(text) and not VINFAST.search(text):
        return None
    sockets = {k.split(":")[1]: tags[k] for k in tags if k.startswith("socket:") and k.count(":") == 1}
    powers = [float(m.group(1)) for k, v in tags.items() if k.startswith("socket:") and k.endswith(":output") for m in [POWER_RE.search(v)] if m]
    car = tags.get("motorcar") == "yes" or any(s in sockets for s in CAR_SOCKETS)
    scooter = any(tags.get(k) == "yes" for k in ("moped", "scooter", "motorcycle"))
    vehicle = "car" if car else "e-scooter" if scooter else "unknown"
    addr = ", ".join(tags[k] for k in ("addr:housenumber", "addr:street", "addr:subdistrict", "addr:district", "addr:city", "addr:province") if k in tags)
    return {
        "id": f"osm-{el['type']}-{el['id']}", "source": "OSM", "provenance": "observed",
        "name": tags.get("name") or tags.get("operator") or tags.get("brand") or "Charging station (unnamed)",
        "operator": tags.get("operator") or tags.get("brand") or None,
        "brand": _brand(text), "vehicle": vehicle,
        "latitude": float(lat), "longitude": float(lon), "region": region(float(lat), float(lon)),
        "capacity": _int(tags.get("capacity:motorcar") or tags.get("capacity")),
        "sockets": sockets, "max_power_kw": max(powers) if powers else None,
        "address": addr or None, "opening_hours": tags.get("opening_hours"),
        "last_checked": tags.get("check_date"),
        "url": f"https://www.openstreetmap.org/{el['type']}/{el['id']}",
    }


def normalize_ocm(poi: dict[str, Any]) -> dict[str, Any] | None:
    a = poi.get("AddressInfo") or {}
    lat, lon = a.get("Latitude"), a.get("Longitude")
    if lat is None or lon is None:
        return None
    op = (poi.get("OperatorInfo") or {}).get("Title")
    text = " ".join(x for x in (a.get("Title"), op) if x)
    if POWER_INFRA.search(text) and not VINFAST.search(text):
        return None
    conns = poi.get("Connections") or []
    powers = [c["PowerKW"] for c in conns if c.get("PowerKW")]
    sockets: dict[str, Any] = {}
    for c in conns:
        t = ((c.get("ConnectionType") or {}).get("Title") or "unknown").lower()
        sockets[t] = sockets.get(t, 0) + (c.get("Quantity") or 1)
    addr = ", ".join(x for x in (a.get("AddressLine1"), a.get("Town"), a.get("StateOrProvince")) if x)
    return {
        "id": f"ocm-{poi['ID']}", "source": "OCM", "provenance": "observed",
        "name": a.get("Title") or "Charging station (unnamed)", "operator": op,
        "brand": _brand(text), "vehicle": "car",
        "latitude": float(lat), "longitude": float(lon), "region": region(float(lat), float(lon)),
        "capacity": _int(poi.get("NumberOfPoints")), "sockets": sockets, "max_power_kw": max(powers) if powers else None,
        "address": addr or None, "opening_hours": None,
        "last_checked": (poi.get("DateLastVerified") or poi.get("DateLastStatusUpdate") or "")[:10] or None,
        "url": f"https://openchargemap.org/site/poi/details/{poi['ID']}",
    }


def _int(v: Any) -> int | None:
    try:
        return int(str(v).split(";")[0])
    except (TypeError, ValueError):
        return None


def merge(osm: list[dict[str, Any]], ocm: list[dict[str, Any]], radius_m: float = MERGE_RADIUS_M) -> tuple[list[dict[str, Any]], int]:
    """OSM stations plus the OCM stations that are not within radius_m of one. Returns (stations, OCM duplicates skipped)."""
    out = list(osm)
    skipped = 0
    for s in ocm:
        if any(_km(s["latitude"], s["longitude"], o["latitude"], o["longitude"]) * 1000 <= radius_m for o in osm):
            skipped += 1
        else:
            out.append(s)
    return out, skipped


def build(raw: dict[str, Any]) -> dict[str, Any]:
    osm_all = [normalize_osm(e) for e in raw.get("osm", [])]
    ocm_all = [normalize_ocm(p) for p in raw.get("ocm", [])]
    osm = [s for s in osm_all if s]
    ocm = [s for s in ocm_all if s]
    stations, dup = merge(osm, ocm)
    count = lambda key, val: sum(1 for s in stations if s[key] == val)  # noqa: E731
    return {
        "note": "OBSERVED locations from open data. No live status, price, utilization or revenue: those are not in these sources.",
        "attribution": "Station data © OpenStreetMap contributors (ODbL)" + (" · Open Charge Map (CC BY-SA 4.0)" if ocm else ""),
        "fetched_at": raw.get("fetched_at"), "origin": raw.get("origin"), "errors": raw.get("errors", {}),
        "counts": {
            "total": len(stations), "osm": len(osm), "ocm_added": len(stations) - len(osm), "ocm_duplicates_skipped": dup,
            "excluded_power_infrastructure": (len(osm_all) - len(osm)) + (len(ocm_all) - len(ocm)),
            "vinfast": count("brand", "vinfast"), "other": count("brand", "other"), "unknown": count("brand", "unknown"),
            "car": count("vehicle", "car"), "e_scooter": count("vehicle", "e-scooter"),
        },
        "stations": stations,
    }
