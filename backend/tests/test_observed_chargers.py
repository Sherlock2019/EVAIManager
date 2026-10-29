"""Observed (real) station normalisation: no network access, sample records only."""
from __future__ import annotations

from app.services import observed_chargers as oc


def osm(id_: int, lat: float, lon: float, **tags: str) -> dict:
    return {"type": "node", "id": id_, "lat": lat, "lon": lon, "tags": {"amenity": "charging_station", **tags}}


def test_brand_vehicle_and_power_are_read_from_tags():
    s = oc.normalize_osm(osm(1, 10.78, 106.70, operator="VinFast", **{"socket:type2_combo": "2", "socket:type2_combo:output": "60 kW"}))
    assert s["brand"] == "vinfast" and s["vehicle"] == "car" and s["max_power_kw"] == 60
    assert s["provenance"] == "observed" and s["source"] == "OSM" and s["region"] == "Ho Chi Minh City"
    assert s["url"] == "https://www.openstreetmap.org/node/1"
    assert oc.normalize_osm(osm(2, 21.03, 105.83, name="Trạm sạc V-Green"))["brand"] == "vinfast"
    assert oc.normalize_osm(osm(3, 21.03, 105.83, operator="EV ONE"))["brand"] == "other"
    unknown = oc.normalize_osm(osm(4, 15.0, 107.0))
    assert unknown["brand"] == "unknown" and unknown["vehicle"] == "unknown" and unknown["region"] == "Other provinces"
    assert oc.normalize_osm(osm(5, 21.03, 105.83, operator="VinFast", moped="yes"))["vehicle"] == "e-scooter"


def test_power_grid_infrastructure_is_dropped():
    assert oc.normalize_osm(osm(6, 10.1, 105.6, operator="TBA 220kV Châu Thành")) is None
    assert oc.normalize_osm(osm(7, 11.3, 108.8, name="Nhiệt điện vĩnh tân")) is None


def test_ocm_only_fills_gaps():
    base = [oc.normalize_osm(osm(1, 10.7800, 106.7000, operator="VinFast"))]
    near = {"ID": 9, "AddressInfo": {"Title": "VinFast Station", "Latitude": 10.7803, "Longitude": 106.7002}, "Connections": [{"PowerKW": 30, "Quantity": 2}]}
    far = {"ID": 10, "AddressInfo": {"Title": "EV ONE", "Latitude": 10.80, "Longitude": 106.75}, "Connections": []}
    stations, dup = oc.merge(base, [oc.normalize_ocm(near), oc.normalize_ocm(far)])
    assert dup == 1 and [s["id"] for s in stations] == ["osm-node-1", "ocm-10"]


def test_build_counts_and_errors_pass_through():
    out = oc.build({"osm": [osm(1, 10.78, 106.70, operator="VinFast"), osm(2, 10.1, 105.6, operator="TBA Tam Quan")], "ocm": [], "errors": {"ocm": "not configured"}})
    assert out["counts"]["total"] == 1 and out["counts"]["excluded_power_infrastructure"] == 1
    assert out["errors"]["ocm"] == "not configured" and "OpenStreetMap" in out["attribution"]
    assert "price" not in out["stations"][0] and "utilization" not in out["stations"][0]


def test_observed_api_serves_the_bundled_snapshot(client):
    out = client.get("/api/chargers/observed").json()
    assert out["origin"] in ("bundled snapshot", "cache")
    assert out["counts"]["total"] > 100 and out["counts"]["vinfast"] > 100
    assert all(s["provenance"] == "observed" for s in out["stations"])
    synthetic = {c["station_id"] for c in client.get("/api/chargers").json()}
    assert not synthetic & {s["id"] for s in out["stations"]}   # kept separate from the synthetic network
