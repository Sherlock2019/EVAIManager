"""Layering rules from the README, enforced: routers -> services -> data, one way only."""
from __future__ import annotations

import ast
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"
# telemetry_service holds the connected WebSocket clients, so it needs the type
FASTAPI_ALLOWED = {"telemetry_service.py"}


def _imports(path: Path) -> set[str]:
    found: set[str] = set()
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            found.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            found.add(node.module)
            found.update(f"{node.module}.{alias.name}" for alias in node.names)
    return found


def _offenders(folder: str, banned: tuple[str, ...], allowed: set[str] = frozenset()) -> list[str]:
    return sorted(f"{p.name} imports {name}" for p in (APP / folder).glob("*.py") if p.name not in allowed
                  for name in _imports(p) if name.startswith(banned))


def test_services_do_not_depend_on_http_or_routers():
    assert _offenders("services", ("fastapi", "starlette"), FASTAPI_ALLOWED) == []
    assert _offenders("services", ("app.routers", "app.main")) == []


def test_only_the_data_layer_touches_storage():
    for folder in ("services", "routers"):
        assert _offenders(folder, ("sqlite3", "app.data.database")) == []


def test_data_layer_does_not_depend_on_http_or_routers():
    assert _offenders("data", ("fastapi", "app.routers", "app.main")) == []


def test_environment_is_read_only_in_config():
    readers = sorted(str(p.relative_to(APP)) for p in APP.rglob("*.py") if "os.getenv" in p.read_text(encoding="utf-8") or "os.environ" in p.read_text(encoding="utf-8"))
    assert readers == ["config.py"]
