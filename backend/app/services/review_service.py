"""Human-in-the-loop review: apply a reviewer decision and feed it back into the
next training dataset."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from app.data.generator import VN_TZ
from app.data.repository import Repository
from app.schemas.adas import ReviewRequest

BUILDING_VERSION = "ADAS-v24"

# Corrections captured since the service started, per object class. Drives the
# simulated uplift of the next model candidate.
session_corrections: dict[str, int] = {}


def apply_review(repo: Repository, frame: dict[str, Any], req: ReviewRequest, persist: bool = True) -> dict[str, Any]:
    objects = frame["objects"]
    corrected = 0

    if req.action == "accept":
        for o in objects:
            o["source"] = "human_verified"
        frame["label_status"] = "human_accepted"
        headline, message = "LABELS CONFIRMED", f"Frame verified and added to Dataset v24."
    elif req.action == "reject":
        frame["label_status"] = "human_rejected"
        headline, message = "FRAME REJECTED", "Frame excluded from training data; flagged for sensor-quality audit."
    else:
        by_id = {o["id"]: o for o in objects}
        for c in req.corrections:
            o = by_id.get(c.object_id)
            if o is None:
                continue
            o.setdefault("original_cls", o["cls"])
            o.setdefault("original_confidence", o["confidence"])
            if c.cls:
                o["cls"] = c.cls
            if c.bbox:
                o["bbox"] = [round(float(x), 4) for x in c.bbox]
            o["confidence"] = c.confidence if c.confidence is not None else 1.0
            o["source"] = "human"
            session_corrections[o["cls"]] = session_corrections.get(o["cls"], 0) + 1
            corrected += 1
        if req.new_object is not None:
            objects.append({
                "id": max((o["id"] for o in objects), default=0) + 1, "cls": req.new_object.cls, "confidence": 1.0,
                "bbox": [round(float(x), 4) for x in req.new_object.bbox], "occluded": False, "small": False,
                "factors": ["missed by model"], "source": "human",
            })
            session_corrections[req.new_object.cls] = session_corrections.get(req.new_object.cls, 0) + 1
            corrected += 1
        frame["objects_detected"] = len(objects)
        frame["label_status"] = "human_corrected"
        headline, message = "HUMAN FEEDBACK CAPTURED", "Correction will be added to Dataset v24."

    frame["review_required"] = False
    frame["dataset_version"] = None if req.action == "reject" else BUILDING_VERSION

    dataset = repo.dataset(BUILDING_VERSION)
    if req.action != "reject":
        dataset["frames_added"] += 1
        dataset["frames_total"] += 1
        dataset["human_corrections"] += corrected
        if frame["scenario_category"] != "nominal":
            dataset["edge_cases_added"] += 1

    created = datetime.now(VN_TZ).isoformat(timespec="seconds")
    review = {"frame_id": frame["frame_id"], "action": req.action, "reviewer": req.reviewer, "created_at": created,
              "detail": {"corrections": corrected}}
    repo.add_review(review, persist)
    if persist:
        repo.save_frame(frame)
        repo.save_datasets()

    return {
        "frame": frame, "headline": headline, "message": message,
        "dataset_version": frame["dataset_version"],
        "queue_remaining": len(repo.review_queue()),
        "dataset": dataset,
    }
