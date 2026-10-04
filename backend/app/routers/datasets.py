from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from app.schemas.adas import DatasetVersion
from app.state import repo

router = APIRouter(prefix="/api/datasets", tags=["datasets"])


@router.get("", response_model=list[DatasetVersion])
def list_datasets() -> list[dict[str, Any]]:
    """Training dataset versions; ADAS-v24 grows as humans review frames."""
    return repo.datasets
