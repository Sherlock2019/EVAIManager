"""Priority charging queue: a fixed-time-step discrete-event simulator.

SIMULATION ONLY. Brand priority is a proposed policy; nothing here claims that
VinFast or V-Green uses it today. No real charger, reservation or payment is touched.

Each step (default 1 simulated minute) is processed in a fixed order:
    1. sessions that reached their end time complete (a session is NEVER interrupted)
    2. charger outages start or end (an outage on a busy port waits for the session to end)
    3. waiting drivers whose cancel time has passed leave the queue
    4. new arrivals join the queue
    5. dispatch: free online ports are filled from the queue

Dispatch rules, in order:
    1. Safety and compatibility first: a vehicle only goes to a port whose
       compatibility with its group is "confirmed" ("unverified" only when the
       operator allows it). Vehicles with incomplete compatibility data wait
       for verification and are never assigned.
    2. Active sessions are never interrupted.
    3. Among eligible vehicles: lowest effective priority class first
       (default VinFast 1, Tesla 2, other brands 3), then first-come first-served.
    4. Optional anti-starvation (ageing): every `anti_starvation_min` minutes
       waited lifts a vehicle one class, never above class 1. Shown when it applies.
    5. Optional reserved VinFast ports: a reserved port takes a non-VinFast
       vehicle only when no VinFast vehicle is waiting AND the port has been idle
       for `reserve_release_idle_min` (release policy).
    6. Optional cap on simultaneous third-party sessions.
    7. Absent drivers (no-shows) are skipped when called and the port is offered
       to the next driver in the same step.

Estimated wait (ETA) for each queued vehicle is recomputed after every arrival,
cancellation, start, completion, outage and policy change by running the same
dispatch rules forward from the current state with no further arrivals.
"""
from __future__ import annotations

import copy
import math
import random
from typing import Any, Literal

from pydantic import BaseModel, Field

GROUPS = ("vinfast", "tesla", "other")
Group = Literal["vinfast", "tesla", "other"]
Compat = Literal["confirmed", "unverified", "incompatible"]
DEFAULT_PRIORITY = {"vinfast": 1, "tesla": 2, "other": 3}
CHARGE_TAPER = 1.15          # sessions take ~15 % longer than kWh / power because of the charging curve
LOOKAHEAD_LIMIT_MIN = 600    # ETA lookahead stops after this many simulated minutes
DEMO_SEED = 7
DEMO_START = "08:00"

# illustrative vehicle catalogue: (group, model, usable battery kWh, max DC kW)
MODELS = [
    ("vinfast", "VinFast VF 8", 87.7, 150), ("vinfast", "VinFast VF 9", 123.0, 150), ("vinfast", "VinFast VF 6", 59.6, 100),
    ("vinfast", "VinFast VF 7", 75.3, 130), ("vinfast", "VinFast VF 5", 37.2, 50), ("vinfast", "VinFast VF e34", 42.0, 60),
    ("tesla", "Tesla Model 3", 57.5, 170), ("tesla", "Tesla Model Y", 75.0, 250),
    ("other", "Hyundai Ioniq 5", 72.6, 220), ("other", "BYD Atto 3", 60.5, 88), ("other", "Kia EV6", 77.4, 230),
    ("other", "MG4 EV", 61.7, 135), ("other", "BYD Seal", 82.5, 150),
]


class Port(BaseModel):
    port_id: str
    power_kw: float = Field(120, gt=0, le=400)
    compat: dict[str, Compat] = Field(default_factory=lambda: {"vinfast": "confirmed", "tesla": "confirmed", "other": "confirmed"})
    reserved_vinfast: bool = False
    offline_from: float | None = None
    offline_to: float | None = None


class Arrival(BaseModel):
    vehicle_id: str
    group: Group
    model: str = ""
    arrive_min: float = Field(ge=0)
    soc_pct: float | None = Field(None, ge=0, le=100)
    kwh: float = Field(gt=0, le=200)
    max_kw: float = Field(150, gt=0, le=400)
    compat_known: bool = True
    no_show: bool = False
    cancel_min: float | None = None


class QueuePolicy(BaseModel):
    priority: dict[str, int] = Field(default_factory=lambda: dict(DEFAULT_PRIORITY))
    anti_starvation_min: float | None = Field(None, ge=5, le=240, description="None = off")
    reserved_vinfast_ports: int = Field(0, ge=0, le=20)
    reserve_release_idle_min: float = Field(10, ge=0, le=120)
    third_party_max_ports: int | None = Field(None, ge=0, le=50, description="None = no cap")
    allow_unverified: bool = False
    target_avg_wait_vinfast_min: float = Field(10, ge=1, le=120)
    target_p90_wait_vinfast_min: float = Field(25, ge=1, le=240)


class QueueRequest(BaseModel):
    policy: QueuePolicy = QueuePolicy()
    step_min: float = Field(1, ge=0.5, le=10)
    horizon_min: float = Field(180, ge=30, le=720)
    ports: list[Port] | None = None          # None = demo site
    arrivals: list[Arrival] | None = None    # None = seeded demo busy period
    extra_arrivals: list[Arrival] = Field(default_factory=list)
    seed: int = DEMO_SEED


# --- demo data -------------------------------------------------------------------------
def demo_ports() -> list[Port]:
    """SYNTHETIC SITE: 6 DC ports. Compatibility values are simulation assumptions, not test results."""
    vf_only = {"vinfast": "confirmed", "tesla": "incompatible", "other": "incompatible"}
    open_ = {"vinfast": "confirmed", "tesla": "confirmed", "other": "confirmed"}
    return [
        Port(port_id="P1", power_kw=150, compat=vf_only),
        Port(port_id="P2", power_kw=150, compat=vf_only),
        Port(port_id="P3", power_kw=120, compat=open_),
        Port(port_id="P4", power_kw=120, compat=open_, offline_from=70, offline_to=100),
        Port(port_id="P5", power_kw=60, compat=open_),
        Port(port_id="P6", power_kw=60, compat={"vinfast": "confirmed", "tesla": "unverified", "other": "confirmed"}),
    ]


def demo_arrivals(seed: int = DEMO_SEED, horizon_min: float = 180) -> list[Arrival]:
    """A seeded morning rush: arrivals front-loaded, all three groups, a few no-shows and a cancellation."""
    rng = random.Random(seed)
    counts = {"vinfast": 22, "tesla": 11, "other": 11}
    rows: list[Arrival] = []
    n = 0
    for group, count in counts.items():
        pool = [m for m in MODELS if m[0] == group]
        for _ in range(count):
            n += 1
            _, model, cap, max_kw = rng.choice(pool)
            t = round(min(horizon_min * 0.85, rng.betavariate(1.3, 2.2) * horizon_min))
            soc = rng.randint(10, 40)
            kwh = round(cap * (80 - soc) / 100, 1)
            rows.append(Arrival(vehicle_id="", group=group, model=model, arrive_min=t, soc_pct=soc, kwh=kwh, max_kw=max_kw))
    rows.sort(key=lambda r: (r.arrive_min, r.group))
    for i, r in enumerate(rows, start=1):
        r.vehicle_id = f"EV-{i:02d}"
    # scripted edge cases so every rule is visible in the demo
    rows[5].no_show = True
    rows[17].no_show = True
    later = next(r for r in rows[9:] if r.group != "vinfast")
    later.cancel_min = later.arrive_min + 8
    unknown = next(r for r in rows if r.group == "other" and r.arrive_min > 30)
    unknown.compat_known = False
    unknown.model = "Imported EV (model unverified)"
    return rows


# --- simulation ---------------------------------------------------------------------------
def _duration(v: dict[str, Any], port: dict[str, Any]) -> float:
    return v["kwh"] / min(port["power_kw"], v["max_kw"]) * 60 * CHARGE_TAPER


def _compatible(v: dict[str, Any], port: dict[str, Any], policy: QueuePolicy) -> bool:
    if not v["compat_known"]:
        return False
    status = port["compat"].get(v["group"], "incompatible")
    return status == "confirmed" or (status == "unverified" and policy.allow_unverified)


def _effective(v: dict[str, Any], t: float, policy: QueuePolicy) -> tuple[int, bool]:
    base = policy.priority.get(v["group"], 9)
    if policy.anti_starvation_min:
        lifted = max(1, base - int((t - v["arrive_min"]) // policy.anti_starvation_min))
        return lifted, lifted < base
    return base, False


def _blocked_reason(v: dict[str, Any], ports: list[dict[str, Any]], policy: QueuePolicy) -> str | None:
    if not v["compat_known"]:
        return "Compatibility data incomplete: needs verification before any assignment"
    if not any(_compatible(v, p, policy) for p in ports):
        return "No port at this site is confirmed compatible for this vehicle group"
    return None


def _dispatch(state: dict[str, Any], t: float, policy: QueuePolicy, log: list[dict[str, Any]] | None) -> bool:
    """Fill free ports. Returns True when anything changed."""
    changed = False
    ports = state["ports"]
    while True:
        free = [p for p in ports if p["vehicle"] is None and not p["offline"]]
        if not free:
            return changed
        waiting = [v for v in state["queue"]]
        tp_active = sum(1 for p in ports if p["vehicle"] and p["vehicle"]["group"] != "vinfast")
        vf_waiting = any(v["group"] == "vinfast" and v["compat_known"] for v in waiting)
        order = sorted(waiting, key=lambda v: (_effective(v, t, policy)[0], v["arrive_min"], v["vehicle_id"]))
        assigned = False
        for v in order:
            if v["group"] != "vinfast" and policy.third_party_max_ports is not None and tp_active >= policy.third_party_max_ports:
                continue
            options = []
            for p in free:
                if not _compatible(v, p, policy):
                    continue
                if p["reserved"] and v["group"] != "vinfast":
                    if vf_waiting or t - p["idle_since"] < policy.reserve_release_idle_min:
                        continue
                options.append(p)
            if not options:
                continue
            # VinFast drivers use reserved ports first and others use shared ports first,
            # so reserved capacity is only released when nothing else is free
            options.sort(key=lambda p: (p["reserved"] != (v["group"] == "vinfast"), p["port_id"]))
            port = options[0]
            state["queue"].remove(v)
            if v["no_show"]:
                v.update(status="absent", called_min=t)
                state["done"].append(v)
                if log is not None:
                    log.append({"t": t, "type": "absent", "vehicle_id": v["vehicle_id"], "port_id": port["port_id"],
                                "text": f"{v['vehicle_id']} called to {port['port_id']} but absent; port offered to next driver"})
            else:
                eff, promoted = _effective(v, t, policy)
                dur = _duration(v, port)
                v.update(status="charging", start_min=t, end_min=t + dur, port_id=port["port_id"], wait_min=t - v["arrive_min"],
                         promoted=promoted, effective_priority=eff)
                port["vehicle"] = v
                if log is not None:
                    note = f" (anti-starvation lifted to P{eff})" if promoted else ""
                    released = " on a released reserved port" if port["reserved"] and v["group"] != "vinfast" else ""
                    log.append({"t": t, "type": "start", "vehicle_id": v["vehicle_id"], "port_id": port["port_id"],
                                "text": f"{v['vehicle_id']} ({v['group']}) starts on {port['port_id']}{released}{note}, waited {t - v['arrive_min']:.0f} min"})
            assigned = changed = True
            break
        if not assigned:
            return changed


def _step(state: dict[str, Any], t: float, policy: QueuePolicy, arrivals: list[dict[str, Any]], log: list[dict[str, Any]] | None) -> bool:
    changed = False
    for p in state["ports"]:
        v = p["vehicle"]
        if v and v["end_min"] <= t:
            v["status"] = "completed"
            state["done"].append(v)
            p["vehicle"], p["idle_since"] = None, t
            changed = True
            if log is not None:
                log.append({"t": t, "type": "complete", "vehicle_id": v["vehicle_id"], "port_id": p["port_id"], "text": f"{v['vehicle_id']} completes on {p['port_id']}"})
        should_be_offline = p["offline_from"] is not None and p["offline_from"] <= t < (p["offline_to"] or math.inf)
        if should_be_offline != p["offline"] and p["vehicle"] is None:
            p["offline"] = should_be_offline
            p["idle_since"] = t
            changed = True
            if log is not None:
                log.append({"t": t, "type": "outage" if should_be_offline else "restored", "vehicle_id": None, "port_id": p["port_id"],
                            "text": f"{p['port_id']} {'goes offline' if should_be_offline else 'back online'}"})
    for v in list(state["queue"]):
        if v["cancel_min"] is not None and v["cancel_min"] <= t:
            state["queue"].remove(v)
            v.update(status="cancelled", wait_min=t - v["arrive_min"])
            state["done"].append(v)
            changed = True
            if log is not None:
                log.append({"t": t, "type": "cancel", "vehicle_id": v["vehicle_id"], "port_id": None, "text": f"{v['vehicle_id']} cancels and leaves the queue"})
    while arrivals and arrivals[0]["arrive_min"] <= t:
        v = arrivals.pop(0)
        v["status"] = "waiting"
        state["queue"].append(v)
        changed = True
        if log is not None:
            log.append({"t": t, "type": "arrive", "vehicle_id": v["vehicle_id"], "port_id": None, "text": f"{v['vehicle_id']} {v['model']} ({v['group']}) arrives, needs {v['kwh']:.0f} kWh"})
    return _dispatch(state, t, policy, log) or changed


def _eta(state: dict[str, Any], t: float, step: float, policy: QueuePolicy) -> dict[str, float | None]:
    """Estimated start time for every queued vehicle if nobody else arrives (no-shows and cancels unknown)."""
    sim = copy.deepcopy(state)
    for v in sim["queue"]:
        v["no_show"], v["cancel_min"] = False, None
    starts: dict[str, float | None] = {v["vehicle_id"]: None for v in sim["queue"]}
    now = t
    while sim["queue"] and now - t < LOOKAHEAD_LIMIT_MIN:
        now += step
        _step(sim, now, policy, [], None)
        for p in sim["ports"]:
            v = p["vehicle"]
            if v and v["vehicle_id"] in starts and starts[v["vehicle_id"]] is None:
                starts[v["vehicle_id"]] = v["start_min"]
    return starts


def _pct(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    k = (len(s) - 1) * q
    lo, hi = math.floor(k), math.ceil(k)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def _clock(t: float) -> str:
    h, m = map(int, DEMO_START.split(":"))
    total = h * 60 + m + int(round(t))
    return f"{total // 60 % 24:02d}:{total % 60:02d}"


def simulate(req: QueueRequest) -> dict[str, Any]:
    policy = req.policy
    port_models = req.ports or demo_ports()
    arrival_models = (req.arrivals if req.arrivals is not None else demo_arrivals(req.seed, req.horizon_min)) + req.extra_arrivals
    # reserved VinFast capacity is taken from the shared ports (a VinFast-only port is reserved by nature)
    shared = [p.port_id for p in port_models if any(p.compat.get(g) != "incompatible" for g in ("tesla", "other"))]
    reserve = set(shared[:policy.reserved_vinfast_ports])
    ports = []
    for p in port_models:
        d = p.model_dump()
        d["reserved"] = d.pop("reserved_vinfast") or p.port_id in reserve
        d.update(vehicle=None, offline=False, idle_since=0.0)
        ports.append(d)
    pending = sorted((a.model_dump() for a in arrival_models), key=lambda v: (v["arrive_min"], v["vehicle_id"]))
    vehicles = {v["vehicle_id"]: v for v in pending}
    state: dict[str, Any] = {"ports": ports, "queue": [], "done": []}

    log: list[dict[str, Any]] = []
    snapshots: list[dict[str, Any]] = []
    alerts: list[dict[str, Any]] = []
    eta: dict[str, float | None] = {}
    t = 0.0
    while t <= req.horizon_min:
        n_before = len(log)
        if _step(state, t, policy, pending, log) or t == 0:
            eta = _eta(state, t, req.step_min, policy)
            snapshots.append(_snapshot(state, t, policy, eta, log[n_before:]))
            _check_targets(state, t, policy, alerts)
        t += req.step_min
    # let sessions already running finish so their stats are complete (never interrupted)
    for p in state["ports"]:
        if p["vehicle"]:
            p["vehicle"]["status"] = "charging_at_end"
    for v in state["queue"]:
        v["status"], v["wait_min"] = "waiting_at_end", req.horizon_min - v["arrive_min"]

    return {
        "note": "SIMULATED QUEUE on a SYNTHETIC SITE. Brand priority is a proposed policy, not current practice of any operator.",
        "start_clock": DEMO_START, "step_min": req.step_min, "horizon_min": req.horizon_min,
        "policy": policy.model_dump(),
        "ports": [{k: p[k] for k in ("port_id", "power_kw", "compat", "reserved", "offline_from", "offline_to")} for p in ports],
        "vehicles": [_public(v) for v in vehicles.values()],
        "snapshots": snapshots,
        "log": [{**e, "clock": _clock(e["t"])} for e in log],
        "stats": stats(list(vehicles.values())),
        "alerts": alerts,
        "wait_method": "Wait = session start minus arrival, in simulated minutes at the chosen time step. ETA = start time from re-running "
                       "the same dispatch rules forward with no further arrivals; recomputed after every event.",
    }


def _public(v: dict[str, Any]) -> dict[str, Any]:
    keys = ("vehicle_id", "group", "model", "arrive_min", "soc_pct", "kwh", "max_kw", "compat_known", "no_show", "cancel_min",
            "status", "start_min", "end_min", "port_id", "wait_min", "promoted", "effective_priority")
    return {k: v.get(k) for k in keys}


def _snapshot(state: dict[str, Any], t: float, policy: QueuePolicy, eta: dict[str, float | None], events: list[dict[str, Any]]) -> dict[str, Any]:
    order = sorted(state["queue"], key=lambda v: (_effective(v, t, policy)[0], v["arrive_min"], v["vehicle_id"]))
    queue = []
    for pos, v in enumerate(order, start=1):
        eff, promoted = _effective(v, t, policy)
        base = policy.priority.get(v["group"], 9)
        blocked = _blocked_reason(v, state["ports"], policy)
        reason = f"Priority {base} ({v['group']}), FIFO within class, arrived {_clock(v['arrive_min'])}"
        if promoted:
            reason = f"Anti-starvation: lifted from P{base} to P{eff} after {t - v['arrive_min']:.0f} min waiting"
        queue.append({
            "vehicle_id": v["vehicle_id"], "group": v["group"], "model": v["model"], "position": pos, "priority": base,
            "effective_priority": eff, "promoted": promoted, "arrive_min": v["arrive_min"], "kwh": v["kwh"],
            "est_start_min": eta.get(v["vehicle_id"]), "reason": reason, "blocked": blocked,
            "compatible_ports": [p["port_id"] for p in state["ports"] if _compatible(v, p, policy)],
        })
    ports = []
    for p in state["ports"]:
        v = p["vehicle"]
        status = "offline" if p["offline"] else "charging" if v else "reserved_idle" if p["reserved"] else "free"
        ports.append({"port_id": p["port_id"], "status": status, "reserved": p["reserved"],
                      "vehicle_id": v["vehicle_id"] if v else None, "group": v["group"] if v else None,
                      "end_min": v["end_min"] if v else None, "pending_outage": bool(v and p["offline_from"] is not None and p["offline_from"] <= t < (p["offline_to"] or math.inf))})
    counts = {g: sum(1 for v in state["queue"] if v["group"] == g) for g in GROUPS}
    return {"t": t, "clock": _clock(t), "queue": queue, "ports": ports, "queue_counts": counts, "events": [e["text"] for e in events]}


def stats(vehicles: list[dict[str, Any]]) -> dict[str, Any]:
    out = {}
    for g in GROUPS:
        vs = [v for v in vehicles if v["group"] == g]
        waits = [v["wait_min"] for v in vs if v.get("status") in ("charging", "completed", "charging_at_end")]
        out[g] = {
            "arrived": len(vs), "served": len(waits),
            "absent": sum(1 for v in vs if v.get("status") == "absent"),
            "cancelled": sum(1 for v in vs if v.get("status") == "cancelled"),
            "waiting_at_end": sum(1 for v in vs if v.get("status") == "waiting_at_end"),
            "avg_wait": round(sum(waits) / len(waits), 1) if waits else None,
            "p90_wait": round(_pct(waits, 0.9), 1) if waits else None,
            "max_wait": round(max(waits), 1) if waits else None,
        }
    return out


def _check_targets(state: dict[str, Any], t: float, policy: QueuePolicy, alerts: list[dict[str, Any]]) -> None:
    started = [v for v in state["done"] + [p["vehicle"] for p in state["ports"] if p["vehicle"]]
               if v["group"] == "vinfast" and v.get("start_min") is not None]
    waits = [v["wait_min"] for v in started] + [t - v["arrive_min"] for v in state["queue"] if v["group"] == "vinfast"]
    if not waits:
        return
    avg, p90 = sum(waits) / len(waits), _pct(waits, 0.9)
    kinds = {a["kind"] for a in alerts}
    if avg > policy.target_avg_wait_vinfast_min and "avg" not in kinds:
        alerts.append({"t": t, "clock": _clock(t), "kind": "avg", "text": f"VinFast average wait {avg:.1f} min exceeds target {policy.target_avg_wait_vinfast_min:g} min"})
    if p90 > policy.target_p90_wait_vinfast_min and "p90" not in kinds:
        alerts.append({"t": t, "clock": _clock(t), "kind": "p90", "text": f"VinFast p90 wait {p90:.1f} min exceeds target {policy.target_p90_wait_vinfast_min:g} min"})
