from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.schemas.adas import Frame, FramePage, ReviewRequest, ReviewResponse
from app.services import adas_label_engine as engine
from app.services import edge_case_engine, model_metrics, review_service
from app.state import repo

router = APIRouter(prefix="/api/adas", tags=["adas"])


@router.get("/frames", response_model=FramePage)
def list_frames(
    status: str | None = Query(None, description="label_status filter"),
    scenario: str | None = None,
    weather: str | None = None,
    lighting: str | None = None,
    max_confidence: float | None = Query(None, ge=0, le=1),
    limit: int = Query(40, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    items = repo.frames
    if status:
        items = [f for f in items if f["label_status"] == status]
    if scenario:
        items = [f for f in items if f["scenario_category"] == scenario]
    if weather:
        items = [f for f in items if f["weather"] == weather]
    if lighting:
        items = [f for f in items if f["lighting"] == lighting]
    if max_confidence is not None:
        items = [f for f in items if f["model_confidence"] <= max_confidence]
    return {"total": len(items), "items": items[offset:offset + limit]}


@router.get("/frames/{frame_id}", response_model=Frame)
def get_frame(frame_id: str) -> dict[str, Any]:
    frame = repo.get_frame(frame_id)
    if frame is None:
        raise HTTPException(404, f"Frame {frame_id} not found")
    return frame


@router.get("/pipeline")
def pipeline_stats() -> dict[str, Any]:
    """Auto-label routing statistics for the frame sample."""
    frames = repo.frames
    routing = {"auto_accept": 0, "sample_review": 0, "human_review": 0}
    status: dict[str, int] = {}
    histogram = [0] * 14  # confidence 0.30-1.00 in 0.05 bins
    by_condition: dict[str, dict[str, list[float]]] = {"weather": {}, "lighting": {}, "road_type": {}}
    by_class: dict[str, list[float]] = {}
    for f in frames:
        c = f["model_confidence"]
        routing[engine.route_frame(c)] += 1
        status[f["label_status"]] = status.get(f["label_status"], 0) + 1
        histogram[min(13, max(0, int((c - 0.30) / 0.05)))] += 1
        for dim in by_condition:
            by_condition[dim].setdefault(f[dim], []).append(c)
        for o in f["objects"]:
            if o["source"] == "ai":
                by_class.setdefault(o["cls"], []).append(o["confidence"])
    mean = lambda xs: round(sum(xs) / len(xs), 3)  # noqa: E731
    return {
        "total_frames": len(frames),
        "total_labels": sum(len(f["objects"]) for f in frames),
        "thresholds": {"auto_accept": engine.AUTO_ACCEPT_THRESHOLD, "human_review": engine.HUMAN_REVIEW_THRESHOLD},
        "routing": routing,
        "label_status": status,
        "review_queue": len(repo.review_queue()),
        "histogram": [{"bin": f"{0.30 + i * 0.05:.2f}", "lo": round(0.30 + i * 0.05, 2), "count": n} for i, n in enumerate(histogram)],
        "confidence_by": {dim: [{"key": k, "avg_confidence": mean(v), "frames": len(v)} for k, v in rows.items()]
                          for dim, rows in by_condition.items()},
        "confidence_by_class": sorted(({"key": k, "avg_confidence": mean(v), "labels": len(v)} for k, v in by_class.items()),
                                      key=lambda r: r["avg_confidence"]),
        "penalties": {
            "lighting": engine.LIGHTING_PENALTY, "weather": engine.WEATHER_PENALTY,
            "situational": {"tunnel": engine.TUNNEL_PENALTY, "occlusion": engine.OCCLUSION_PENALTY,
                            "small object": engine.SMALL_OBJECT_PENALTY, "pedestrian near road": engine.NEAR_ROAD_PENALTY,
                            "motorcycle between cars": engine.BETWEEN_CARS_PENALTY},
        },
    }


@router.get("/review-queue", response_model=FramePage)
def review_queue(limit: int = Query(30, ge=1, le=200)) -> dict[str, Any]:
    """Frames waiting for a human, weakest confidence first."""
    queue = repo.review_queue()
    return {"total": len(queue), "items": queue[:limit]}


@router.post("/review/{frame_id}", response_model=ReviewResponse)
def review(frame_id: str, req: ReviewRequest) -> dict[str, Any]:
    """Apply a reviewer decision: accept, correct, reject or add a missed object."""
    frame = repo.get_frame(frame_id)
    if frame is None:
        raise HTTPException(404, f"Frame {frame_id} not found")
    if req.action == "add_object" and req.new_object is None:
        raise HTTPException(422, "new_object is required for add_object")
    return review_service.apply_review(repo, frame, req)


@router.get("/edge-cases")
def edge_cases() -> dict[str, Any]:
    return edge_case_engine.mine(repo.frames)


@router.get("/model-metrics")
def metrics() -> dict[str, Any]:
    return model_metrics.build(review_service.session_corrections)
