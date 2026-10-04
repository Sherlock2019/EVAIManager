from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class Detection(BaseModel):
    id: int
    cls: str
    confidence: float
    bbox: list[float] = Field(description="[x, y, w, h] normalised to the camera image")
    occluded: bool = False
    small: bool = False
    factors: list[str] = []
    source: str = "ai"
    original_cls: str | None = None
    original_confidence: float | None = None


class Frame(BaseModel):
    frame_id: str
    vehicle_id: str
    city: str
    timestamp: str
    latitude: float
    longitude: float
    speed_kmh: float
    weather: str
    lighting: str
    road_type: str
    camera_front_path: str
    lidar_available: bool
    objects: list[Detection]
    objects_detected: int
    model_confidence: float
    label_status: str
    review_required: bool
    dataset_version: str | None
    scenario_category: str


class FramePage(BaseModel):
    total: int
    items: list[Frame]


class Correction(BaseModel):
    object_id: int
    cls: str | None = None
    confidence: float | None = Field(None, ge=0, le=1)
    bbox: list[float] | None = None


class NewObject(BaseModel):
    cls: str
    bbox: list[float]


class ReviewRequest(BaseModel):
    action: Literal["accept", "correct", "reject", "add_object"]
    corrections: list[Correction] = []
    new_object: NewObject | None = None
    reviewer: str = "demo.reviewer"


class ReviewResponse(BaseModel):
    frame: Frame
    headline: str
    message: str
    dataset_version: str | None
    queue_remaining: int
    dataset: dict[str, Any]


class EdgeCase(BaseModel):
    key: str
    scenario: str
    events: int
    average_confidence: float
    error_rate: float
    priority: str
    pending_review: int
    human_corrected: int
    top_city: str
    top_city_events: int
    frames_requested: int
    sample_frames: list[str]


class DatasetVersion(BaseModel):
    version: str
    frames_total: int
    frames_added: int
    status: str
    created: str
    human_corrections: int
    edge_cases_added: int
    model: str
    class_distribution: dict[str, float]
    weather_distribution: dict[str, float]
    city_distribution: dict[str, float]
