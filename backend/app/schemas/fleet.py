from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class Vehicle(BaseModel):
    vehicle_id: str
    model: str
    year: int
    city: str
    zone: str
    latitude: float
    longitude: float
    battery_soc: float
    battery_soh: float
    battery_temperature: float
    motor_temperature: float
    odometer_km: int
    daily_km: float
    charging_cycles: int
    average_efficiency: float
    tire_pressure_fl: float
    tire_pressure_fr: float
    tire_pressure_rl: float
    tire_pressure_rr: float
    fault_codes: list[str]
    last_service: str
    next_service: str
    health_score: int
    maintenance_risk: str
    status: str
    speed_kmh: float
    moving: bool
    route_id: str | None = None


class VehiclePage(BaseModel):
    total: int
    items: list[Vehicle]


class MaintenancePrediction(BaseModel):
    vehicle_id: str
    model: str
    city: str
    maintenance_probability: float
    maintenance_risk: str
    health_score: int
    predicted_component: str
    component_key: str | None
    predicted_days_to_service: int | None
    service_by: str | None
    confidence: float | None
    reason_codes: list[str]
    recommended_action: str
    anomaly_score: float
    component_risks: dict[str, float]
    booked: bool = False


class TwinSection(BaseModel):
    name: str
    health_score: int
    trend: str
    risk: str
    metric: str
    prediction: str
    history: list[float]


class VehicleDetail(BaseModel):
    vehicle: Vehicle
    prediction: MaintenancePrediction
    estimated_range_km: int
    motor_efficiency_pct: int
    battery_kwh: float
    digital_twin: list[TwinSection]
    booking: dict[str, Any] | None = None


class Charger(BaseModel):
    station_id: str
    name: str
    city: str
    zone: str
    latitude: float
    longitude: float
    ports: int
    available: int
    utilization: float
    avg_daily_sessions: int
    peak_window: str
    forecast_90d_pct: float
    power_kw: int
    fast: bool
    status: str
    action: str | None = None
    recommendation: str | None = None
    add_ports: int = 0


class CopilotRequest(BaseModel):
    question: str


class CopilotResponse(BaseModel):
    intent: str
    answer: str
    items: list[dict[str, Any]] = []
    suggestions: list[str] = []
    link: str | None = None


class SimControl(BaseModel):
    running: bool | None = None
    speed: float | None = None


class InjectRequest(BaseModel):
    vehicle_id: str | None = None
    issue: str = "thermal"
