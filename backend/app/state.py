"""Process-wide singletons shared by routers."""
from app.data.repository import repo
from app.services.telemetry_service import LiveSimulation

sim = LiveSimulation(repo)

__all__ = ["repo", "sim"]
