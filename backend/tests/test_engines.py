"""Unit tests for the decision logic: the rules a reviewer would ask about first."""
from __future__ import annotations

import numpy as np

from app.services import adas_label_engine as label
from app.services import charger_optimizer, edge_case_engine, maintenance_engine
from app.services.charger_optimizer import Scenario


def test_confidence_routing_thresholds():
    assert label.route_frame(0.95) == "auto_accept"
    assert label.route_frame(0.90) == "auto_accept"
    assert label.route_frame(0.89) == "sample_review"
    assert label.route_frame(0.70) == "sample_review"
    assert label.route_frame(0.69) == "human_review"


def test_difficult_conditions_lower_confidence():
    def avg(ctx: label.SceneContext, **flags: bool) -> float:
        rng = np.random.default_rng(0)
        return float(np.mean([label.score_detection("motorcycle", ctx, rng, **flags)[0] for _ in range(300)]))

    easy = avg(label.SceneContext("clear", "day", "urban"))
    night = avg(label.SceneContext("clear", "night", "urban"))
    storm = avg(label.SceneContext("heavy_rain", "night", "urban"), between_cars=True, occluded=True)
    assert easy > night > storm
    assert easy >= 0.90 and storm < 0.70


def test_frame_is_as_weak_as_its_weakest_label():
    assert label.frame_confidence([{"confidence": 0.97}, {"confidence": 0.58}, {"confidence": 0.91}]) == 0.58


def test_maintenance_risk_bands():
    assert [maintenance_engine.risk_level(p) for p in (0, 30, 31, 60, 61, 80, 81, 100)] == [
        "LOW", "LOW", "MEDIUM", "MEDIUM", "HIGH", "HIGH", "CRITICAL", "CRITICAL"]


def _vehicle(**over):
    v = {
        "vehicle_id": "VF-EV-0001", "model": "VF 8", "city": "Hanoi", "battery_temperature": 33.0, "battery_soh": 96.0,
        "motor_temperature": 64.0, "odometer_km": 20000, "charging_cycles": 70, "charging_cycles_expected": 70,
        "average_efficiency": 190.0, "km_since_service": 4000, "fault_codes": [], "daily_km": 45.0,
        "tire_pressure_fl": 2.4, "tire_pressure_fr": 2.4, "tire_pressure_rl": 2.4, "tire_pressure_rr": 2.4,
    }
    v.update(over)
    return v


def test_healthy_vehicle_is_low_risk_with_no_predicted_component():
    p = maintenance_engine.predict(_vehicle())
    assert p["maintenance_risk"] == "LOW"
    assert p["predicted_component"] == "None"
    assert p["predicted_days_to_service"] is None


def test_overheating_battery_is_explained():
    p = maintenance_engine.predict(_vehicle(battery_temperature=50.0, fault_codes=["BMS-T01"]))
    assert p["maintenance_risk"] == "CRITICAL"
    assert p["predicted_component"] == "Battery Cooling System"
    assert any("battery temperature" in r for r in p["reason_codes"])
    assert 1 <= p["predicted_days_to_service"] <= 5


def test_low_tire_names_the_wheel():
    p = maintenance_engine.predict(_vehicle(tire_pressure_rr=1.95))
    assert p["predicted_component"] == "Rear-right Tire"
    assert p["maintenance_risk"] in ("HIGH", "CRITICAL")


def test_site_score_follows_the_published_formula():
    site = {"name": "X", "city": "Y", "lat": 0, "lon": 0, "route_density": 0.97, "charging_demand": 0.95,
            "nearest_fast_km": 7.8, "growth": 0.85, "accessibility": 0.88, "nearby_utilization": 0.87, "reasons": []}
    scored = charger_optimizer.score_site(site, charger_optimizer.BASELINE)
    expected = 100 * (0.30 * 0.97 + 0.25 * 0.95 + 0.20 * (7.8 / 8) + 0.15 * 0.85 + 0.10 * 0.88)
    assert abs(scored["score_raw"] - expected) < 0.06
    assert scored["score"] == 94 and scored["recommended"]


def test_optimizer_can_recommend_not_building():
    planned = {"name": "Quiet", "city": "Y", "lat": 0, "lon": 0, "planned_ports": 12, "nearby_utilization": 0.18,
               "nearby_chargers": 62, "growth": 0.04}
    result = charger_optimizer.evaluate_planned(planned, charger_optimizer.BASELINE)
    assert result["action"] == "DO NOT EXPAND"
    assert result["avoided_investment_usd"] == 12 * charger_optimizer.COST_PER_PORT_USD


def test_more_ev_growth_never_reduces_recommended_capacity():
    station = {"station_id": "CS-1", "name": "S", "city": "Y", "latitude": 0, "longitude": 0, "ports": 12,
               "utilization": 0.8, "forecast_90d_pct": 15}
    low = charger_optimizer.evaluate_station(station, Scenario(ev_growth_pct=10))
    high = charger_optimizer.evaluate_station(station, Scenario(ev_growth_pct=90))
    assert high["projected_utilization"] > low["projected_utilization"]
    assert high["add_ports"] >= low["add_ports"]


def test_edge_case_priority_from_error_rate():
    assert edge_case_engine.priority(edge_case_engine.estimated_error_rate(0.61)) == "CRITICAL"
    assert edge_case_engine.priority(edge_case_engine.estimated_error_rate(0.68)) == "HIGH"
    assert edge_case_engine.priority(edge_case_engine.estimated_error_rate(0.73)) == "MEDIUM"
    assert edge_case_engine.priority(edge_case_engine.estimated_error_rate(0.88)) == "LOW"
