"""Copilot, guided demo, simulation controls and the live WebSocket."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from app.schemas.fleet import CopilotRequest, CopilotResponse, InjectRequest, SimControl
from app.services import copilot, dashboard_service, demo_orchestrator, review_service
from app.state import repo, sim

router = APIRouter(tags=["system"])


@router.post("/api/copilot/ask", response_model=CopilotResponse)
def copilot_ask(req: CopilotRequest) -> dict[str, Any]:
    return copilot.ask(repo, req.question)


@router.get("/api/copilot/suggestions")
def copilot_suggestions() -> list[str]:
    return copilot.SUGGESTIONS


@router.post("/api/demo/step/{step}")
def demo_step(step: int) -> dict[str, Any]:
    """Run one step (1-11) of the guided AI demo. Step 1 resets demo state."""
    try:
        return demo_orchestrator.run_step(repo, step)
    except ValueError as e:
        raise HTTPException(422, str(e)) from None


@router.get("/api/sim/state")
def sim_state() -> dict[str, Any]:
    return sim.state()


@router.post("/api/sim/control")
async def sim_control(req: SimControl) -> dict[str, Any]:
    if req.running is not None:
        sim.running = req.running
    if req.speed is not None:
        sim.speed = min(4.0, max(0.25, req.speed))
    # a paused simulator sends no ticks, so tell clients about the new state directly
    await sim.broadcast({"type": "state", "state": sim.state(), "summary": dashboard_service.summary(repo, sim)})
    return sim.state()


@router.post("/api/sim/inject")
def sim_inject(req: InjectRequest) -> dict[str, Any]:
    """Inject a component fault into a vehicle and re-run the maintenance engine."""
    try:
        return sim.inject_issue(req.vehicle_id, req.issue)
    except KeyError:
        raise HTTPException(404, f"Vehicle {req.vehicle_id} not found") from None


@router.post("/api/sim/reset")
async def sim_reset() -> dict[str, Any]:
    """Regenerate the synthetic world from the seed (clears reviews and bookings).

    Runs on the event loop on purpose: the simulation tick cannot interleave
    with a half-rebuilt world.
    """
    repo.load(force_regenerate=True)
    sim.prepare()
    sim.events.clear()
    sim.frames_today = 2_840_000
    sim.running, sim.speed = True, 1.0
    review_service.session_corrections.clear()
    demo_orchestrator._pristine_frame = None
    demo_orchestrator._base_trips = None
    return sim.state()


@router.get("/api/live/tick")
def live_tick() -> dict[str, Any]:
    """Latest simulation delta; polling fallback for clients without WebSocket."""
    return sim.last_tick or {"type": "tick", "seq": 0, "positions": [], "chargers": [], "adas_events": []}


@router.websocket("/ws/live")
async def live_socket(ws: WebSocket) -> None:
    await sim.connect(ws)
    try:
        while True:
            await ws.receive_text()  # keep-alive; clients only listen
    except WebSocketDisconnect:
        pass
    finally:
        sim.disconnect(ws)
