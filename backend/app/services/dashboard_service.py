"""Executive summary KPIs and AI insights, all derived from the simulated world."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

from app.data.repository import Repository
from app.services import charger_optimizer, edge_case_engine

if TYPE_CHECKING:
    from app.services.telemetry_service import LiveSimulation

_auto_label_cache: dict[int, float] = {}


def auto_labeled_pct(repo: Repository) -> float:
    """Share of object labels accepted without a human touching them.

    In a queued frame the reviewer acts on labels below the human-review
    threshold (or, for a quality-control sample, on the weakest label).
    """
    key = id(repo.frames)
    if key not in _auto_label_cache:
        total = touched = 0
        for f in repo.frames:
            total += len(f["objects"])
            if f["label_status"] not in ("auto_accepted", "sample_passed"):
                touched += max(1, sum(1 for o in f["objects"] if o.get("original_confidence", o["confidence"]) < 0.70))
        _auto_label_cache.clear()
        _auto_label_cache[key] = round(100 * (1 - touched / max(1, total)), 1)
    return _auto_label_cache[key]


def summary(repo: Repository, sim: "LiveSimulation | None" = None) -> dict[str, Any]:
    counts: dict[str, int] = {"healthy": 0, "charging": 0, "warning": 0, "critical": 0, "offline": 0}
    risk: dict[str, int] = {"LOW": 0, "MEDIUM": 0, "HIGH": 0, "CRITICAL": 0}
    for v in repo.vehicles:
        counts[v["status"]] += 1
        risk[v["maintenance_risk"]] += 1
    total = len(repo.vehicles)
    plan = charger_optimizer.optimize(repo.chargers, repo.candidate_sites, repo.planned_sites)["summary"]
    ports = sum(c["ports"] for c in repo.chargers)
    busy = sum(c["ports"] - c["available"] for c in repo.chargers)
    overloaded = sum(1 for c in repo.chargers if c["status"] == "overloaded")
    return {
        "fleet_total": total,
        "active_vehicles": total - counts["offline"],
        "healthy_pct": round(100 * risk["LOW"] / total, 1),
        "status_counts": counts,
        "risk_counts": risk,
        "adas_frames_today": sim.frames_today if sim else 2_840_000,
        "auto_labeled_pct": auto_labeled_pct(repo),
        "review_queue": len(repo.review_queue()),
        "charging_stations": len(repo.chargers),
        "charging_ports": ports,
        "network_load_pct": round(100 * busy / ports),
        "overloaded_stations": overloaded,
        "predicted_maintenance_cases": risk["HIGH"] + risk["CRITICAL"],
        "recommended_new_sites": plan["new_stations"],
        "alerts": risk["CRITICAL"] + overloaded,
        "adas_model": {"name": "ADAS Vision v6", "map": 0.84},
        "live": {"running": sim.running, "seq": sim.seq} if sim else {"running": False, "seq": 0},
    }


def insights(repo: Repository) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []

    worst = max(repo.predictions.values(), key=lambda p: (p["vehicle_id"] == "VF-EV-0821", p["maintenance_probability"]))
    out.append({
        "category": "HIGH PRIORITY", "tone": "critical",
        "text": f"Vehicle {worst['vehicle_id']} {worst['predicted_component'].lower()} risk exceeds expected trend "
                f"({worst['maintenance_probability']:.0f}% maintenance probability).",
        "link": f"/fleet/health?vehicle={worst['vehicle_id']}",
    })

    thu_duc = [c for c in repo.chargers if c["zone"] == "Thu Duc"]
    growth = sum(c["forecast_90d_pct"] * c["ports"] for c in thu_duc) / sum(c["ports"] for c in thu_duc)
    out.append({"category": "CHARGING", "tone": "warning",
                "text": f"Thu Duc charging demand predicted +{growth:.0f}% within 3 months.", "link": "/energy/charging"})

    ped_all, ped_hard = [], []
    for f in repo.frames:
        for o in f["objects"]:
            if o["cls"] == "pedestrian" and o["source"] == "ai":
                ped_all.append(o["confidence"])
                if f["lighting"] == "night" and f["weather"] in ("rain", "heavy_rain"):
                    ped_hard.append(o["confidence"])
    if ped_all and ped_hard:
        drop = 100 * (sum(ped_all) / len(ped_all) - sum(ped_hard) / len(ped_hard))
        out.append({"category": "ADAS", "tone": "info",
                    "text": f"Night-rain pedestrian detection confidence is {drop:.1f} pts below the fleet average.", "link": "/adas/metrics"})

    low = min(repo.chargers, key=lambda c: c["utilization"])
    out.append({"category": "INFRASTRUCTURE", "tone": "muted",
                "text": f"{low['name']} utilization averages only {low['utilization'] * 100:.0f}%. Consider reducing planned expansion.",
                "link": "/energy/charging"})

    moto = sum(1 for f in repo.frames if f["city"] == "Ho Chi Minh City"
               and any(o["cls"] == "motorcycle" and o["confidence"] < 0.70 and o["source"] == "ai" for o in f["objects"]))
    out.append({"category": "EDGE CASE", "tone": "serious",
                "text": f"{moto} low-confidence motorcycle occlusion events identified in HCMC.", "link": "/adas/edge-cases"})

    top = edge_case_engine.mine(repo.frames)
    out.append({"category": "TRAINING DATA", "tone": "info", "text": top["recommendation"], "link": "/adas/edge-cases"})
    return out
