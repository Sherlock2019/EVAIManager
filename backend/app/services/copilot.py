"""Deterministic AI copilot.

No LLM involved: questions are matched to an intent with keywords and answered
from the same services that drive the dashboards, so answers always agree with
what is on screen.
"""
from __future__ import annotations

import re
from typing import Any

from app.data.repository import Repository
from app.services import charger_optimizer, dashboard_service, edge_case_engine, model_metrics

SUGGESTIONS = [
    "Which vehicles need maintenance?",
    "Where should we install new chargers?",
    "Why is VF-EV-0821 high risk?",
    "Which charger is overloaded?",
    "Where is charging capacity excessive?",
    "Which ADAS scenarios need more training data?",
    "How did the ADAS model improve?",
]
VEHICLE_RE = re.compile(r"vf[\s-]*(?:ev[\s-]*)?(\d{1,4})\b", re.I)


def _has(q: str, *words: str) -> bool:
    return any(w in q for w in words)


def ask(repo: Repository, question: str) -> dict[str, Any]:
    q = question.lower().strip()
    match = VEHICLE_RE.search(q)
    # "VF 8" style model names are not vehicle ids; ids have 3+ digits or an explicit EV prefix.
    if match and (len(match.group(1)) >= 3 or "ev" in match.group(0).lower()):
        return _vehicle(repo, match.group(1))
    if _has(q, "overload", "busy", "saturat", "congest", "full"):
        return _overloaded(repo)
    if _has(q, "underutil", "excess", "unnecessary", "reduce", "too many", "avoid", "low util", "not expand"):
        return _excess(repo)
    if _has(q, "charger", "charging", "station", "install", "site", "capacity"):
        return _sites(repo)
    if _has(q, "maintenance", "service", "repair", "risk", "fail", "health"):
        return _maintenance(repo)
    if _has(q, "scenario", "edge", "training data", "label", "dataset", "review"):
        return _edge_cases(repo)
    if _has(q, "model", "map", "recall", "precision", "adas", "improve"):
        return _model()
    if _has(q, "fleet", "summary", "status", "overview", "how many"):
        return _fleet(repo)
    return {
        "intent": "help",
        "answer": "I answer from the simulated fleet, charging and ADAS data. Try one of the suggested questions.",
        "items": [], "suggestions": SUGGESTIONS, "link": None,
    }


def _vehicle(repo: Repository, digits: str) -> dict[str, Any]:
    v = repo.get_vehicle(digits)
    if v is None:
        return {"intent": "vehicle", "answer": f"I could not find vehicle VF-EV-{int(digits):04d} in the simulated fleet.",
                "items": [], "suggestions": SUGGESTIONS[:3], "link": None}
    p = repo.predictions[v["vehicle_id"]]
    if p["maintenance_risk"] == "LOW":
        answer = (f"{v['vehicle_id']} ({v['model']}, {v['city']}) is healthy: health score {p['health_score']}/100, "
                  f"maintenance probability {p['maintenance_probability']:.0f}%. No component is trending toward service.")
    else:
        reasons = "\n".join(f"+ {r}" for r in p["reason_codes"])
        answer = (f"{v['vehicle_id']} ({v['model']}, {v['city']}) is {p['maintenance_risk']} risk at "
                  f"{p['maintenance_probability']:.0f}% maintenance probability.\n\n"
                  f"Predicted component: {p['predicted_component']}\n"
                  f"Service needed within: {p['predicted_days_to_service']} days\n\nReasons:\n{reasons}")
    return {"intent": "vehicle", "answer": answer,
            "items": [{"title": v["vehicle_id"], "value": f"{p['maintenance_probability']:.0f}%", "caption": p["predicted_component"]}],
            "suggestions": ["Which vehicles need maintenance?", "Where should we install new chargers?"],
            "link": f"/fleet/health?vehicle={v['vehicle_id']}"}


def _maintenance(repo: Repository) -> dict[str, Any]:
    cases = sorted((p for p in repo.predictions.values() if p["maintenance_risk"] in ("CRITICAL", "HIGH")),
                   key=lambda p: p["maintenance_probability"], reverse=True)
    critical = sum(1 for p in cases if p["maintenance_risk"] == "CRITICAL")
    lines = "\n".join(
        f"{i}. {p['vehicle_id']} ({p['model']}) — {p['maintenance_probability']:.0f}% · {p['predicted_component']} · "
        f"service within {p['predicted_days_to_service']} days" for i, p in enumerate(cases[:5], 1))
    return {"intent": "maintenance",
            "answer": f"{len(cases)} vehicles are predicted to need maintenance ({critical} critical). Most urgent:\n\n{lines}\n\n"
                      "Risk is scored from battery temperature, state of health, tire pressure trend, motor temperature, "
                      "charging frequency and fault codes.",
            "items": [{"title": p["vehicle_id"], "value": f"{p['maintenance_probability']:.0f}%", "caption": p["predicted_component"]} for p in cases[:5]],
            "suggestions": [f"Why is {cases[0]['vehicle_id']} high risk?", "Which charger is overloaded?"] if cases else SUGGESTIONS[:2],
            "link": "/fleet/maintenance"}


def _sites(repo: Repository) -> dict[str, Any]:
    plan = charger_optimizer.optimize(repo.chargers, repo.candidate_sites, repo.planned_sites)
    top = [s for s in plan["sites"] if s["recommended"]][:3]
    lines = "\n\n".join(f"{i}. {s['name']}\n   {s['score']}/100 opportunity score" for i, s in enumerate(top, 1))
    s = plan["summary"]
    return {"intent": "charger_sites",
            "answer": f"Based on current simulated travel patterns:\n\n{lines}\n\n"
                      "The primary drivers are route density, charger saturation and distance from existing fast chargers. "
                      f"In total I recommend +{s['new_stations']} new stations and +{s['added_ports']} ports at existing stations, "
                      f"while {s['unnecessary_planned_sites']} planned sites look unnecessary.",
            "items": [{"title": x["name"], "value": f"{x['score']}/100", "caption": f"{x['expected_sessions_per_day']} sessions/day"} for x in top],
            "suggestions": ["Where is charging capacity excessive?", "Which charger is overloaded?"],
            "link": "/energy/charging"}


def _overloaded(repo: Repository) -> dict[str, Any]:
    hot = sorted((c for c in repo.chargers if c["status"] == "overloaded"), key=lambda c: c["utilization"], reverse=True)
    lines = "\n".join(f"{i}. {c['name']} ({c['city']}) — {c['utilization'] * 100:.0f}% utilization, "
                      f"{c['ports']} ports, forecast +{c['forecast_90d_pct']:.0f}%" for i, c in enumerate(hot[:5], 1))
    return {"intent": "overloaded",
            "answer": f"{len(hot)} stations are overloaded (above 85% average utilization):\n\n{lines}\n\n"
                      "These stations are the main inputs to the expansion recommendations.",
            "items": [{"title": c["name"], "value": f"{c['utilization'] * 100:.0f}%", "caption": f"{c['ports']} ports"} for c in hot[:5]],
            "suggestions": ["Where should we install new chargers?", "Where is charging capacity excessive?"],
            "link": "/energy/charging"}


def _excess(repo: Repository) -> dict[str, Any]:
    plan = charger_optimizer.optimize(repo.chargers, repo.candidate_sites, repo.planned_sites)
    skip = [p for p in plan["planned_sites"] if p["action"] == "DO NOT EXPAND"]
    lines = "\n".join(f"{i}. {p['name']} — nearby utilization {p['nearby_utilization'] * 100:.0f}%, "
                      f"{p['nearby_chargers']} chargers nearby, growth {p['predicted_demand_growth_pct']:.0f}% → DO NOT EXPAND "
                      f"(≈${p['avoided_investment_usd']:,} avoided*)" for i, p in enumerate(skip, 1))
    total = plan["summary"]["avoided_investment_usd"]
    return {"intent": "excess_capacity",
            "answer": f"AI should not always recommend building more. {len(skip)} planned sites are not supported by observed demand:\n\n"
                      f"{lines}\n\nEstimated avoided investment: ${total:,}*\n*Illustrative mock estimate.",
            "items": [{"title": p["name"], "value": f"{p['nearby_utilization'] * 100:.0f}%", "caption": "DO NOT EXPAND"} for p in skip],
            "suggestions": ["Where should we install new chargers?"],
            "link": "/energy/charging"}


def _edge_cases(repo: Repository) -> dict[str, Any]:
    mined = edge_case_engine.mine(repo.frames)
    top = mined["cases"][:4]
    lines = "\n".join(f"{i}. {c['scenario']} — {c['events']} events, avg confidence {c['average_confidence'] * 100:.0f}%, "
                      f"est. error {c['error_rate'] * 100:.0f}% · {c['priority']}" for i, c in enumerate(top, 1))
    return {"intent": "edge_cases",
            "answer": f"The scenarios where the model is most likely to fail:\n\n{lines}\n\nRecommendation: {mined['recommendation']}",
            "items": [{"title": c["scenario"], "value": f"{c['average_confidence'] * 100:.0f}%", "caption": c["priority"]} for c in top],
            "suggestions": ["How did the ADAS model improve?", "Which vehicles need maintenance?"],
            "link": "/adas/edge-cases"}


def _model() -> dict[str, Any]:
    rows = [r for r in model_metrics.build({})["comparison"] if r["metric"] in ("mAP", "Pedestrian Recall", "Motorcycle Recall")]
    lines = "\n".join(f"{r['metric']}: {r['v5']:.2f} → {r['v6']:.2f}" for r in rows)
    return {"intent": "model",
            "answer": f"ADAS Vision v6 versus v5 (mock demo metrics):\n\n{lines}\n\n"
                      "The gain comes from human-corrected edge cases added to the training dataset, "
                      "mainly motorcycles and pedestrians in rain and at night.",
            "items": [{"title": r["metric"], "value": f"{r['v6']:.2f}", "caption": f"was {r['v5']:.2f}"} for r in rows],
            "suggestions": ["Which ADAS scenarios need more training data?"],
            "link": "/adas/metrics"}


def _fleet(repo: Repository) -> dict[str, Any]:
    s = dashboard_service.summary(repo)
    return {"intent": "fleet",
            "answer": f"{s['active_vehicles']:,} of {s['fleet_total']:,} simulated vehicles are online and {s['healthy_pct']}% are healthy. "
                      f"{s['predicted_maintenance_cases']} vehicles are predicted to need maintenance, the review queue holds "
                      f"{s['review_queue']:,} ADAS frames and {s['overloaded_stations']} of {s['charging_stations']} charging stations are overloaded.",
            "items": [{"title": "Active", "value": f"{s['active_vehicles']:,}", "caption": "vehicles"},
                      {"title": "Healthy", "value": f"{s['healthy_pct']}%", "caption": "of fleet"},
                      {"title": "Maintenance", "value": str(s["predicted_maintenance_cases"]), "caption": "predicted cases"}],
            "suggestions": SUGGESTIONS[:3], "link": "/"}
