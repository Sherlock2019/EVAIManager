"""VinFast AI Mobility Intelligence Lab — API.

Independent technology demonstration using synthetic data.
Not an official VinFast product.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import config
from app.routers import adas, chargers, dashboard, datasets, maintenance, rides, routes, system, vehicles
from app.state import repo, sim

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    repo.load()
    sim.start()
    yield
    await sim.stop()


app = FastAPI(
    title="VinFast AI Mobility Intelligence Lab",
    description=config.DISCLAIMER,
    version="1.0.0",
    lifespan=lifespan,
    # served under /api so the frontend proxy (Vite or nginx) reaches them too
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
)
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])

for module in (dashboard, vehicles, maintenance, chargers, routes, rides, adas, datasets, system):
    app.include_router(module.router)


@app.get("/api/health", tags=["system"])
def health() -> dict[str, Any]:
    return {"status": "ok", "vehicles": len(repo.vehicles), "frames": len(repo.frames), "disclaimer": config.DISCLAIMER}
