"""One failure, one code: the HTTP routers and the MCP tools share the services under ``app/services``."""

import ast
import asyncio
from collections.abc import Callable, Generator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from fastmcp import Client
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import schemas
from app.auth import current_subject
from app.config import settings
from app.database import Base, get_session
from app.errors import ServiceError
from app.main import app
from app.mcp_server import TravelMcpBackend, create_mcp_server
from app.models import McpAuditEvent, Visit
from app.services import visits as visit_service

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
APP = Path(__file__).parent.parent / "app"


@event.listens_for(engine, "connect")
def enable_foreign_keys(dbapi_connection: object, _: object) -> None:
    dbapi_connection.execute("PRAGMA foreign_keys=ON")


def override_session() -> Generator[Session]:
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


def setup_function() -> None:
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


def teardown_function() -> None:
    app.dependency_overrides.clear()


@pytest.fixture
def backend(monkeypatch: pytest.MonkeyPatch) -> TravelMcpBackend:
    monkeypatch.setattr(settings, "environment", "development")
    monkeypatch.setattr(settings, "mcp_development_subject", "owner-1")
    return TravelMcpBackend(TestingSessionLocal)


@pytest.fixture
def http() -> TestClient:
    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[current_subject] = lambda: "owner-1"
    return TestClient(app)


def http_code(response: Any) -> str:
    assert response.status_code in {404, 422}, response.text
    return response.json()["errors"][0]["code"]


def _area(http: TestClient, trip_id: str, label: str) -> str:
    created = http.post(f"/api/trips/{trip_id}/areas", json={"label": label})
    assert created.status_code == 201, created.text
    return created.json()["id"]


# Each case: the HTTP route and body, and the MCP call that sends the same input.
CASES: dict[str, tuple[str, str, dict, Callable[[TravelMcpBackend, str, dict], Any]]] = {
    "visit in an unknown area": (
        "post",
        "visits",
        {"area_id": "no-such-area", "title": "Old town"},
        lambda b, trip, body: b.create_visit(trip, schemas.VisitCreate(**body)),
    ),
    "stay in an unknown area": (
        "post",
        "stays",
        {"area_id": "no-such-area", "check_in_date": "2054-12-01", "check_out_date": "2054-12-03"},
        lambda b, trip, body: b.create_stay(trip, schemas.StayCreate(**body)),
    ),
    "route to an unknown area": (
        "post",
        "routes",
        {"mode": "train", "departure_area_id": "{area}", "arrival_area_id": "no-such-area"},
        lambda b, trip, body: b.create_route(trip, schemas.RouteCreate(**body)),
    ),
    "route that arrives before it departs": (
        "post",
        "routes",
        {
            "mode": "train",
            "departure_area_id": "{area}",
            "arrival_area_id": "{other}",
            "departs_at": "2054-12-01T10:00:00Z",
            "arrives_at": "2054-12-01T09:00:00Z",
        },
        lambda b, trip, body: b.create_route(trip, schemas.RouteCreate(**body)),
    ),
    "travel update in an unknown area": (
        "post",
        "travel-updates",
        {"occurred_at": "2054-12-01T12:00:00Z", "title": "Arrived", "area_id": "no-such-area"},
        lambda b, trip, body: b.create_travel_update(trip, schemas.TravelUpdateCreate(**body)),
    ),
}


@pytest.mark.parametrize("case", CASES)
def test_a_refused_input_has_the_same_code_over_http_and_mcp(
    case: str, http: TestClient, backend: TravelMcpBackend
) -> None:
    method, path, body, call = CASES[case]
    trip_id = http.post("/api/trips", json={"title": "Both transports"}).json()["id"]
    placeholders = {"{area}": _area(http, trip_id, "Taipei"), "{other}": _area(http, trip_id, "Tainan")}
    body = {key: placeholders.get(value, value) if isinstance(value, str) else value for key, value in body.items()}

    response = getattr(http, method)(f"/api/trips/{trip_id}/{path}", json=body)
    with pytest.raises(ServiceError) as refused:
        call(backend, trip_id, body)

    assert refused.value.code == http_code(response)
    assert str(refused.value) == response.json()["detail"]


def test_an_unknown_trip_is_not_found_over_http_and_mcp(http: TestClient, backend: TravelMcpBackend) -> None:
    response = http.get("/api/trips/missing/trip-tasks")
    with pytest.raises(ServiceError) as refused:
        backend.list_trip_tasks("missing")

    assert response.status_code == 404
    assert refused.value.code == http_code(response) == "not_found"


def test_a_stay_that_ends_before_it_starts_fails_on_the_model_for_both_transports(
    http: TestClient, backend: TravelMcpBackend
) -> None:
    trip_id = http.post("/api/trips", json={"title": "Nights"}).json()["id"]
    area_id = _area(http, trip_id, "Taipei")
    body = {"area_id": area_id, "check_in_date": "2054-12-03", "check_out_date": "2054-12-01"}
    code = "a_stay_covers_at_least_one_night_check_out_after_the_check_in_date"

    assert http_code(http.post(f"/api/trips/{trip_id}/stays", json=body)) == code
    with pytest.raises(ValueError, match="at least one night") as invalid:
        schemas.StayCreate(**body)
    assert code in str(invalid.value)


def test_a_malformed_id_fails_the_same_way_through_the_mcp_tool_as_through_the_http_path(
    http: TestClient, backend: TravelMcpBackend
) -> None:
    too_long = "x" * 33
    code = http_code(http.get(f"/api/trips/{too_long}/visits"))

    async def run() -> object:
        async with Client(create_mcp_server(TestingSessionLocal)) as client:
            return await client.call_tool("list_visits", {"trip_id": too_long}, raise_on_error=False)

    result = asyncio.run(run())

    assert code == "too_long"
    assert result.is_error and f"trip_id:{code}" in result.content[0].text
    with TestingSessionLocal() as session:
        rejected = session.scalars(select(McpAuditEvent).where(McpAuditEvent.result == "rejected")).one()
    assert rejected.details["error"] == f"Validation failed (trip_id:{code})"


def test_a_service_never_commits_so_its_caller_owns_the_transaction(http: TestClient) -> None:
    trip_id = http.post("/api/trips", json={"title": "Transactions"}).json()["id"]
    area_id = _area(http, trip_id, "Taipei")

    with TestingSessionLocal() as session:
        visit_service.create_visit(
            session, "owner-1", trip_id, schemas.VisitCreate(area_id=area_id, title="Rolled back")
        )
        session.rollback()
    with TestingSessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(Visit)) == 0

    with TestingSessionLocal() as session:
        visit_service.create_visit(session, "owner-1", trip_id, schemas.VisitCreate(area_id=area_id, title="Kept"))
        session.commit()
    with TestingSessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(Visit)) == 1


def _imports(path: Path) -> set[str]:
    """The modules a source file imports, resolved to dotted names inside ``app``."""
    package = ".".join(path.relative_to(APP.parent).with_suffix("").parts[:-1])
    found = set()
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.ImportFrom):
            base = package.split(".")
            base = base[: len(base) - (node.level - 1)] if node.level else []
            module = ".".join([*base, *([node.module] if node.module else [])])
            found.add(module)
            found.update(f"{module}.{alias.name}" for alias in node.names)
        elif isinstance(node, ast.Import):
            found.update(alias.name for alias in node.names)
    return found


def _imports_a_router(path: Path) -> list[str]:
    return sorted(name for name in _imports(path) if name.startswith("app.routers."))


def test_no_router_imports_another_router_and_no_service_imports_a_router() -> None:
    offenders = {
        str(path.relative_to(APP)): _imports_a_router(path)
        for path in [*(APP / "routers").glob("*.py"), *(APP / "services").glob("*.py")]
        if _imports_a_router(path)
    }
    assert offenders == {}


# The features whose tools still call a router function (#369). Remove an entry when its service exists.
ROUTER_IMPORTS_STILL_ALLOWED = {
    "app/main.py",
    "app/mcp_server.py",
}


def test_only_the_application_and_mcp_modules_import_routers() -> None:
    importing = {
        str(path.relative_to(APP.parent))
        for path in APP.rglob("*.py")
        if path.parent.name != "routers" and _imports_a_router(path)
    }
    assert importing <= ROUTER_IMPORTS_STILL_ALLOWED


def test_the_mcp_batch_commit_is_never_replaced() -> None:
    for path in APP.rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text())):
            targets = node.targets if isinstance(node, ast.Assign) else []
            assert not any(isinstance(t, ast.Attribute) and t.attr == "commit" for t in targets), path
        assert "del session.commit" not in path.read_text(), path
