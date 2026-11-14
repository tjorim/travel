"""One failure, one code: the HTTP routers and the MCP tools share the services under ``app/services``."""

import ast
import asyncio
import json
from collections.abc import Callable, Generator
from datetime import UTC, datetime, timedelta
from io import BytesIO
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
from app.errors import Refusal, ServiceError
from app.main import app
from app.mcp_server import MCP_TOOL_CAPABILITIES, BinaryUpload, TravelMcpBackend, create_mcp_server
from app.mcp_server import core as mcp_core
from app.models import (
    Collection,
    CollectionAuditEvent,
    DocumentAsset,
    DocumentKind,
    LinkState,
    ObjectState,
    OwnerActivityEvent,
    PackingList,
    ShareLink,
    StoredObject,
    Visit,
)
from app.services import collections as collection_service
from app.services import documents as document_service
from app.services import packing as packing_service
from app.services import publication as publication_service
from app.services import visits as visit_service
from app.storage import LocalObjectStorage

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
    assert response.status_code in {404, 409, 422}, response.text
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
        rejected = session.scalars(select(OwnerActivityEvent).where(OwnerActivityEvent.result == "rejected")).one()
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


def _same_refusal(response: Any, call: Callable[[], Any]) -> str:
    """Run the MCP call that sends the same input; it must fail with the HTTP response's code and message."""
    with pytest.raises(ServiceError) as refused:
        call()
    assert refused.value.code == http_code(response)
    assert str(refused.value) == response.json()["detail"]
    return refused.value.code


def _trip_with_area(http: TestClient) -> tuple[str, str]:
    trip_id = http.post("/api/trips", json={"title": "Moved features"}).json()["id"]
    return trip_id, _area(http, trip_id, "Taipei")


def _packing_list(http: TestClient, trip_id: str) -> str:
    created = http.post(f"/api/trips/{trip_id}/packing-lists", json={"name": "Carry-on"})
    assert created.status_code == 201, created.text
    return created.json()["id"]


def test_trip_area_and_location_refusals_have_the_same_code_over_http_and_mcp(
    http: TestClient, backend: TravelMcpBackend
) -> None:
    trip_id, area_id = _trip_with_area(http)
    other_id = _area(http, trip_id, "Tainan")
    http.post(f"/api/trips/{trip_id}/visits", json={"area_id": area_id, "title": "Old town"})
    location_id = http.post(
        f"/api/trips/{trip_id}/locations", json={"display_name": "Hotel", "area_id": area_id}
    ).json()["id"]
    base = f"/api/trips/{trip_id}"

    codes = {
        "trip ends before it starts": _same_refusal(
            http.patch(base, json={"starts_on": "2054-12-05", "ends_on": "2054-12-01"}),
            lambda: backend.update_trip(
                trip_id,
                schemas.TripUpdate(starts_on="2054-12-05", ends_on="2054-12-01"),
            ),
        ),
        "unknown area": _same_refusal(
            http.patch(f"{base}/areas/missing", json={"label": "Nowhere"}),
            lambda: backend.update_area(trip_id, "missing", schemas.AreaUpdate(label="Nowhere")),
        ),
        "area still used": _same_refusal(
            http.delete(f"{base}/areas/{area_id}"),
            lambda: backend.delete_area(trip_id, area_id, confirm=True),
        ),
        "area merged into itself": _same_refusal(
            http.post(f"{base}/areas/merge", json={"keep_id": area_id, "duplicate_ids": [area_id]}),
            lambda: backend.merge_areas(trip_id, area_id, [area_id]),
        ),
        "location without an area": _same_refusal(
            http.patch(f"{base}/locations/{location_id}", json={"area_id": None}),
            lambda: backend.update_location(trip_id, location_id, schemas.LocationUpdate(area_id=None)),
        ),
        "unknown location": _same_refusal(
            http.delete(f"{base}/locations/missing"),
            lambda: backend.delete_location(trip_id, "missing", confirm=True),
        ),
        "location merged into itself": _same_refusal(
            http.post(f"{base}/locations/merge", json={"keep_id": location_id, "duplicate_ids": [location_id]}),
            lambda: backend.merge_locations(trip_id, location_id, [location_id]),
        ),
    }
    assert other_id and codes == {
        "trip ends before it starts": "the_trip_cannot_end_before_it_starts",
        "unknown area": "not_found",
        "area still used": "resource_in_use",
        "area merged into itself": "keep_id_cannot_also_be_a_duplicate",
        "location without an area": "every_location_needs_an_area",
        "unknown location": "not_found",
        "location merged into itself": "keep_id_cannot_also_be_a_duplicate",
    }


def test_packing_alternative_and_library_refusals_have_the_same_code_over_http_and_mcp(
    http: TestClient, backend: TravelMcpBackend
) -> None:
    trip_id, _ = _trip_with_area(http)
    list_id = _packing_list(http, trip_id)
    base = f"/api/trips/{trip_id}"

    codes = {
        "item in an unknown bag": _same_refusal(
            http.post(f"{base}/packing-lists/{list_id}/items", json={"label": "Charger", "bag_id": "no-such-bag"}),
            lambda: backend.create_packing_item(
                trip_id, list_id, schemas.PackingItemCreate(label="Charger", bag_id="no-such-bag")
            ),
        ),
        "empty batch": _same_refusal(
            http.post(f"{base}/packing-lists/{list_id}/items/batch", json=[]),
            lambda: backend.batch_create_packing_items(trip_id, list_id, []),
        ),
        "unknown packing list": _same_refusal(
            http.get(f"{base}/packing-lists/missing"), lambda: backend.get_packing_list(trip_id, "missing")
        ),
        "group of unknown records": _same_refusal(
            http.post(f"{base}/alternative-groups", json={"kind": "stay", "member_ids": ["a", "b"]}),
            lambda: backend.create_alternative_group(
                trip_id,
                schemas.AlternativeGroupCreate(kind="stay", member_ids=["a", "b"]),
            ),
        ),
        "unknown group": _same_refusal(
            http.post(f"{base}/alternative-groups/missing/undo-choice"),
            lambda: backend.undo_alternative_choice(trip_id, "missing", confirm=True),
        ),
        "unknown trip document": _same_refusal(
            http.get(f"{base}/documents/missing"), lambda: backend.get_document(trip_id, "missing")
        ),
        "unknown library document": _same_refusal(
            http.get("/api/library/documents/missing"), lambda: backend.get_library_document("missing")
        ),
        "unknown emergency entry": _same_refusal(
            http.get("/api/library/emergency-info/missing"), lambda: backend.get_emergency_info_entry("missing")
        ),
    }
    assert set(codes.values()) == {
        "bag_must_belong_to_this_packing_list",
        "batch_must_contain_1_to_100_items",
        "not_found",
    }


def test_a_structured_refusal_carries_the_same_review_over_http_and_mcp(
    http: TestClient, backend: TravelMcpBackend
) -> None:
    trip_id, _ = _trip_with_area(http)
    location_id = http.post(
        f"/api/trips/{trip_id}/locations", json={"label": "Longshan", "display_name": "Longshan", "locality": "Taipei"}
    ).json()["id"]
    assert (
        http.put(f"/api/trips/{trip_id}/visibility/location/{location_id}", json={"visibility": "everyone"}).status_code
        == 200
    )
    assert http.post(f"/api/trips/{trip_id}/public-projection/publish", json={}).status_code in {200, 201}

    response = http.patch(f"/api/trips/{trip_id}/locations/{location_id}", json={"locality": "Elsewhere"})
    with pytest.raises(ServiceError) as refused:
        backend.update_location(trip_id, location_id, schemas.LocationUpdate(locality="Elsewhere"))

    assert response.status_code == 409
    review = response.json()["detail"]
    assert review["code"] == "visitor_visible_change_needs_acknowledgement" == http_code(response)
    assert refused.value.code == review["code"]
    assert json.loads(str(refused.value)) == review


def test_a_failed_mcp_batch_of_packing_items_keeps_nothing(http: TestClient, backend: TravelMcpBackend) -> None:
    trip_id, _ = _trip_with_area(http)
    list_id = _packing_list(http, trip_id)

    with pytest.raises(ServiceError, match="Bag must belong"):
        backend.batch_create_packing_items(
            trip_id,
            list_id,
            [schemas.PackingItemCreate(label="Passport"), schemas.PackingItemCreate(label="Charger", bag_id="nope")],
        )

    assert backend.list_packing_items(trip_id, list_id) == []


def test_the_moved_services_never_commit(http: TestClient) -> None:
    trip_id, _ = _trip_with_area(http)

    with TestingSessionLocal() as session:
        packing_service.create_packing_list(session, "owner-1", trip_id, schemas.PackingListCreate(name="Rolled back"))
        session.rollback()
    with TestingSessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(PackingList)) == 0

    with TestingSessionLocal() as session:
        packing_service.create_packing_list(session, "owner-1", trip_id, schemas.PackingListCreate(name="Kept"))
        session.commit()
    with TestingSessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(PackingList)) == 1


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


# No module outside ``routers/`` imports from them, except ``main.py``, which mounts every router (#369). The MCP
# tools call the services; never add an entry here.
ROUTER_IMPORTS_ALLOWED = {"app/main.py"}


def test_only_the_application_imports_routers() -> None:
    importing = {
        str(path.relative_to(APP.parent))
        for path in APP.rglob("*.py")
        if path.parent.name != "routers" and _imports_a_router(path)
    }
    assert importing <= ROUTER_IMPORTS_ALLOWED


def _commit_calls(tree: ast.AST) -> list[ast.Call]:
    """The calls of ``.commit()`` in a tree: a reference such as ``checkpoint=session.commit`` is no call."""
    return [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "commit"
    ]


def test_no_service_commits_so_the_transport_owns_the_transaction() -> None:
    offenders = {
        str(path.relative_to(APP)): [call.lineno for call in calls]
        for path in (APP / "services").glob("*.py")
        if (calls := _commit_calls(ast.parse(path.read_text())))
    }
    assert offenders == {}


def test_the_storage_lifecycle_commits_only_when_it_purges() -> None:
    """The object-storage lifecycle (docs/object-storage.md) is split around the caller's commit, not inside it.

    Uploads write bytes and flush rows (rule 1), a removal marks ``purge_pending`` and returns a ``PendingPurge``
    (rule 3), and only the purges commit themselves: they run after the caller's commit, under the deletion lock,
    and delete their own rows."""
    for module in ("document/service.py", "library/service.py", "media/service.py"):
        tree = ast.parse((APP / module).read_text())
        committing = {
            function.name
            for function in ast.walk(tree)
            if isinstance(function, ast.FunctionDef) and _commit_calls(function)
        }
        assert committing <= {"purge_deleted_media", "_purge_pending_objects", "purge_owner_objects"}, module


def test_the_mcp_batch_commit_is_never_replaced() -> None:
    for path in APP.rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text())):
            targets = node.targets if isinstance(node, ast.Assign) else []
            assert not any(isinstance(t, ast.Attribute) and t.attr == "commit" for t in targets), path
        assert "del session.commit" not in path.read_text(), path


# --- Publication, collections, presets, precision and media (the third slice of #369) -----------------------------


def _link(http: TestClient, trip_id: str, *, activate: bool = False) -> str:
    created = http.post(f"/api/trips/{trip_id}/share-links", json={"label": "Family"})
    assert created.status_code == 201, created.text
    link_id = created.json()["id"]
    if activate:
        assert http.post(f"/api/trips/{trip_id}/share-links/{link_id}/activate", json={}).status_code == 200
    return link_id


def test_publication_refusals_have_the_same_code_over_http_and_mcp(http: TestClient, backend: TravelMcpBackend) -> None:
    trip_id, area_id = _trip_with_area(http)
    base = f"/api/trips/{trip_id}"
    draft = _link(http, trip_id)
    active = _link(http, trip_id, activate=True)
    revoked = _link(http, trip_id, activate=True)
    assert http.post(f"{base}/share-links/{revoked}/revoke", json={}).status_code == 200

    codes = {
        "unpublish a page that is not published": _same_refusal(
            http.post(f"{base}/public-projection/unpublish", json={}),
            lambda: backend.unpublish_public_projection(trip_id, confirm=True),
        ),
        "an exclusion on the public view": _same_refusal(
            http.put(f"{base}/public-projection", json={"exclude": [{"kind": "area", "id": area_id}]}),
            lambda: backend.set_public_projection_scope(
                trip_id,
                schemas.ShareScopeInput(exclude=[schemas.ShareScopeItemInput(kind="area", id=area_id)]),
                confirm=True,
            ),
        ),
        "an unknown link": _same_refusal(
            http.get(f"{base}/share-links/missing"), lambda: backend.get_share_link(trip_id, "missing")
        ),
        "activate a link twice": _same_refusal(
            http.post(f"{base}/share-links/{active}/activate", json={}),
            lambda: backend.activate_share_link(trip_id, active, schemas.ShareLinkActivateRequest(), confirm=True),
        ),
        "revoke a draft": _same_refusal(
            http.post(f"{base}/share-links/{draft}/revoke", json={}),
            lambda: backend.revoke_share_link(trip_id, draft, confirm=True),
        ),
        "rotate a draft": _same_refusal(
            http.post(f"{base}/share-links/{draft}/rotate", json={}),
            lambda: backend.rotate_share_link(trip_id, draft, schemas.ShareLinkActivateRequest(), confirm=True),
        ),
        "edit a revoked link": _same_refusal(
            http.patch(f"{base}/share-links/{revoked}", json={"label": "Friends"}),
            lambda: backend.update_share_link(trip_id, revoked, schemas.ShareLinkUpdate(label="Friends"), confirm=True),
        ),
        "preview an unknown file": _same_refusal(
            http.get(f"{base}/public-projection/preview/files/missing"),
            lambda: backend.inspect_public_preview_file(trip_id, "missing"),
        ),
    }
    assert codes == {
        "unpublish a page that is not published": "this_trip_is_not_published",
        "an exclusion on the public view": "scope_exclusion_not_allowed",
        "an unknown link": "not_found",
        "activate a link twice": "only_a_draft_link_can_be_activated",
        "revoke a draft": "only_an_active_link_can_be_revoked",
        "rotate a draft": "only_an_active_link_can_be_rotated",
        "edit a revoked link": "a_revoked_or_expired_link_cannot_be_edited",
        "preview an unknown file": "not_found",
    }


def test_collection_refusals_have_the_same_code_over_http_and_mcp(http: TestClient, backend: TravelMcpBackend) -> None:
    trip_id, _ = _trip_with_area(http)
    collection_id = http.post("/api/collections", json={"label": "Family"}).json()["id"]
    assert http.post(f"/api/collections/{collection_id}/members", json={"trip_id": trip_id}).status_code == 201
    base = f"/api/collections/{collection_id}"

    codes = {
        "unknown collection": _same_refusal(
            http.get("/api/collections/missing"), lambda: backend.get_collection("missing")
        ),
        "the same trip twice": _same_refusal(
            http.post(f"{base}/members", json={"trip_id": trip_id}),
            lambda: backend.add_collection_member(
                collection_id, schemas.CollectionMemberCreate(trip_id=trip_id), confirm=True
            ),
        ),
        "an unknown member": _same_refusal(
            http.delete(f"{base}/members/missing"),
            lambda: backend.remove_collection_member(collection_id, "missing", confirm=True),
        ),
        "revoke a draft": _same_refusal(
            http.post(f"{base}/revoke", json={}), lambda: backend.revoke_collection(collection_id, confirm=True)
        ),
        "rotate a draft": _same_refusal(
            http.post(f"{base}/rotate", json={}),
            lambda: backend.rotate_collection(collection_id, schemas.ShareLinkActivateRequest(), confirm=True),
        ),
    }
    assert codes == {
        "unknown collection": "not_found",
        "the same trip twice": "this_trip_is_already_in_the_collection",
        "an unknown member": "not_found",
        "revoke a draft": "only_an_active_collection_can_be_revoked",
        "rotate a draft": "only_an_active_collection_can_be_rotated",
    }


def test_a_collection_member_of_a_revoked_collection_cannot_be_edited_over_either_transport(
    http: TestClient, backend: TravelMcpBackend
) -> None:
    trip_id, _ = _trip_with_area(http)
    collection_id = http.post("/api/collections", json={"label": "Family"}).json()["id"]
    member = http.post(f"/api/collections/{collection_id}/members", json={"trip_id": trip_id}).json()["members"][0]
    assert http.post(f"/api/collections/{collection_id}/activate", json={}).status_code == 200
    assert http.post(f"/api/collections/{collection_id}/revoke", json={}).status_code == 200

    assert (
        _same_refusal(
            http.put(f"/api/collections/{collection_id}/members/{member['id']}", json={}),
            lambda: backend.update_collection_member(collection_id, member["id"], schemas.ShareScopeInput(), True),
        )
        == "a_revoked_or_expired_collection_cannot_be_edited"
    )


def test_the_future_disclosure_review_is_the_same_over_http_and_mcp_for_every_audience(
    http: TestClient, backend: TravelMcpBackend
) -> None:
    """The public view, a hidden link and a collection member count the same trip alike on both transports (#426)."""
    trip_id = http.post("/api/trips", json={"title": "Not started", "starts_on": "2054-04-01"}).json()["id"]
    departure, arrival = _area(http, trip_id, "Amsterdam"), _area(http, trip_id, "Taipei")
    route = http.post(
        f"/api/trips/{trip_id}/routes",
        json={
            "mode": "flight",
            "departure_area_id": departure,
            "arrival_area_id": arrival,
            "departs_on": "2054-04-02",
            "departs_at": "2054-04-02T09:00:00Z",
            "arrives_at": "2054-04-02T23:00:00Z",
        },
    ).json()
    http.put(f"/api/trips/{trip_id}/visibility/route/{route['id']}", json={"visibility": "custom"})
    scope = {"items": [{"kind": "route", "id": route["id"]}], "defaults": None}
    link = http.post(f"/api/trips/{trip_id}/share-links", json={"label": "Family", "scope": scope}).json()
    collection_id = http.post("/api/collections", json={"label": "Friends"}).json()["id"]
    member = http.post(f"/api/collections/{collection_id}/members", json={"trip_id": trip_id, "scope": scope}).json()[
        "members"
    ][0]
    candidate = schemas.ShareScopeInput(**scope)
    empty = schemas.ShareScopeInput(items=[], defaults=None)

    for name in (
        "preview_public_projection_future_disclosure",
        "preview_share_link_future_disclosure",
        "preview_collection_member_future_disclosure",
    ):
        assert MCP_TOOL_CAPABILITIES[name] == {"effect": "read", "requires_confirmation": False}

    routes = {
        "public": f"/api/trips/{trip_id}/public-projection/future-disclosure",
        "link": f"/api/trips/{trip_id}/share-links/{link['id']}/future-disclosure",
        "member": f"/api/collections/{collection_id}/members/{member['id']}/future-disclosure",
    }
    tools = {
        "public": lambda body: backend.preview_public_projection_future_disclosure(trip_id, body),
        "link": lambda body: backend.preview_share_link_future_disclosure(trip_id, link["id"], body),
        "member": lambda body: backend.preview_collection_member_future_disclosure(collection_id, member["id"], body),
    }
    for kind, route_path in routes.items():
        for body, expected in (
            (candidate, {"transport": 1, "day_dates": 1}),
            (empty, {"transport": 0, "day_dates": 0}),
        ):
            response = http.post(route_path, json=body.model_dump(mode="json"))
            assert response.status_code == 200, response.text
            assert response.json() == tools[kind](body) == expected, kind
    # With no candidate both transports review the saved scope.
    assert http.post(routes["member"]).json() == backend.preview_collection_member_future_disclosure(
        collection_id, member["id"]
    )

    base = f"/api/collections/{collection_id}"
    assert (
        _same_refusal(
            http.post(f"{base}/members/missing/future-disclosure"),
            lambda: backend.preview_collection_member_future_disclosure(collection_id, "missing"),
        )
        == "not_found"
    )
    assert (
        _same_refusal(
            http.post("/api/collections/missing/members/missing/future-disclosure"),
            lambda: backend.preview_collection_member_future_disclosure("missing", "missing"),
        )
        == "not_found"
    )


def test_a_structured_preset_refusal_carries_the_same_review_over_http_and_mcp(
    http: TestClient, backend: TravelMcpBackend
) -> None:
    trip_id, _ = _trip_with_area(http)
    base = f"/api/trips/{trip_id}"
    http.post(f"{base}/travel-updates", json={"occurred_at": "2054-12-01T12:00:00Z", "title": "Arrived"})

    assert (
        _same_refusal(
            http.post(f"{base}/share-links/missing/preset/review", json={"preset": "story_only"}),
            lambda: backend.preview_sharing_preset(trip_id, "story_only", "link:missing"),
        )
        == "not_found"
    )
    response = http.post(
        f"{base}/public-projection/preset",
        json={"preset": "story_only", "fingerprint": "stale", "confirm_widening": False},
    )
    with pytest.raises(ServiceError) as refused:
        backend.apply_sharing_preset(trip_id, "story_only", "stale", confirm=True)

    assert response.status_code == 409
    review = response.json()["detail"]
    assert review["code"] == "preset_preview_is_stale" == http_code(response) == refused.value.code
    assert json.loads(str(refused.value)) == review


def test_a_stale_revision_is_the_same_conflict_for_the_service_as_over_http(http: TestClient) -> None:
    trip_id, _ = _trip_with_area(http)
    base = f"/api/trips/{trip_id}/public-projection"
    assert http.get(base).status_code == 200

    stale = http.put(base, json={}, headers={"If-Match": '"99"'})
    malformed = http.put(base, json={}, headers={"If-Match": "nonsense"})
    with TestingSessionLocal() as session:
        with pytest.raises(Refusal) as conflict:
            publication_service.set_public_projection_scope(
                session, "owner-1", trip_id, schemas.ShareScopeInput(), '"99"'
            )
        with pytest.raises(Refusal) as invalid:
            publication_service.set_public_projection_scope(
                session, "owner-1", trip_id, schemas.ShareScopeInput(), "nonsense"
            )

    assert stale.status_code == conflict.value.status_code == 412
    assert stale.json()["errors"][0]["code"] == conflict.value.code == "scope_revision_conflict"
    assert stale.json()["detail"] == conflict.value.detail
    assert malformed.status_code == invalid.value.status_code == 400
    assert malformed.json()["errors"][0]["code"] == invalid.value.code == "invalid_revision"


def test_a_confirmed_precision_change_that_widens_a_live_audience_is_refused_the_same_way(
    http: TestClient, backend: TravelMcpBackend
) -> None:
    trip_id, area_id = _trip_with_area(http)
    base = f"/api/trips/{trip_id}"
    visit = http.post(
        f"{base}/visits",
        json={"area_id": area_id, "title": "Old town", "starts_on": "2054-12-01", "share_date_precision": "year"},
    ).json()
    assert http.put(f"{base}/visibility/visit/{visit['id']}", json={"visibility": "everyone"}).status_code == 200
    assert http.put(f"{base}/public-projection", json={"defaults": {"date_precision": "day"}}).status_code == 200
    assert http.post(f"{base}/public-projection/publish", json={}).status_code == 200

    response = http.post(f"{base}/date-precision/follow-audience", json={"kinds": ["visit"], "confirm": True})
    with pytest.raises(ServiceError) as refused:
        backend.follow_audience_date_precision(trip_id, ["visit"], confirm=True)

    assert response.status_code == 409
    review = response.json()["detail"]
    assert review["code"] == "precision_widening_needs_acknowledgement" == refused.value.code == http_code(response)
    assert json.loads(str(refused.value)) == review


def test_media_refusals_have_the_same_code_over_http_and_mcp(http: TestClient, backend: TravelMcpBackend) -> None:
    trip_id, _ = _trip_with_area(http)
    base = f"/api/trips/{trip_id}/media"

    codes = {
        "unknown media": _same_refusal(http.get(f"{base}/missing"), lambda: backend.get_media(trip_id, "missing")),
        "candidates for media of another trip": _same_refusal(
            http.post(f"{base}/travel-update-candidates", json={"media_asset_ids": ["missing"]}),
            lambda: backend.suggest_media_travel_update_candidates(
                trip_id, schemas.MediaTravelUpdateCandidatesRequest(media_asset_ids=["missing"])
            ),
        ),
        "a derivative of unknown media": _same_refusal(
            http.post(f"{base}/missing/derivatives", json={}),
            lambda: backend.create_media_derivative(trip_id, "missing", schemas.MediaDerivativeCreate()),
        ),
        "an import from a provider that is no source": _same_refusal(
            http.post(f"{base}/imports/direct_device/sessions"),
            lambda: backend.start_media_import_session(trip_id, "direct_device"),
        ),
    }
    assert codes == {
        "unknown media": "not_found",
        "candidates for media of another trip": "selected_media_must_belong_to_this_trip",
        "a derivative of unknown media": "not_found",
        "an import from a provider that is no source": "not_an_importable_provider",
    }


def test_the_moved_services_never_commit_so_a_rolled_back_call_changes_nothing(http: TestClient) -> None:
    trip_id, _ = _trip_with_area(http)

    with TestingSessionLocal() as session:
        publication_service.create_share_link(session, "owner-1", trip_id, schemas.ShareLinkCreate(label="Rolled back"))
        collection_service.create_collection(session, "owner-1", schemas.CollectionCreate(label="Rolled back"))
        session.rollback()
    with TestingSessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(ShareLink)) == 0
        assert session.scalar(select(func.count()).select_from(Collection)) == 0

    with TestingSessionLocal() as session:
        publication_service.create_share_link(session, "owner-1", trip_id, schemas.ShareLinkCreate(label="Kept"))
        session.commit()
    with TestingSessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(ShareLink)) == 1


def test_an_expired_link_found_by_a_read_is_recorded_in_the_callers_transaction(http: TestClient) -> None:
    trip_id, _ = _trip_with_area(http)
    link_id = _link(http, trip_id, activate=True)
    with TestingSessionLocal() as session:
        link = session.get(ShareLink, link_id)
        link.expires_at = datetime.now(UTC) - timedelta(days=1)
        session.commit()

    with TestingSessionLocal() as session:
        shown = publication_service.get_share_link(session, "owner-1", trip_id, link_id)
        assert shown.state == LinkState.EXPIRED
        session.rollback()  # the service did not commit the expiry itself
    with TestingSessionLocal() as session:
        assert session.get(ShareLink, link_id).state == LinkState.ACTIVE
        publication_service.get_share_link(session, "owner-1", trip_id, link_id)
        session.commit()
    with TestingSessionLocal() as session:
        assert session.get(ShareLink, link_id).state == LinkState.EXPIRED


# --- The object-storage lifecycle around the caller's commit (docs/object-storage.md) ------------------------------


def _uploaded_document(session: Session, storage: LocalObjectStorage, trip_id: str, data: bytes) -> str:
    uploaded, _ = document_service.upload_document(
        session,
        storage,
        "owner-1",
        trip_id,
        title="Ticket",
        document_kind=DocumentKind.OTHER,
        filename="ticket.txt",
        content_type="text/plain",
        file=BytesIO(data),
    )
    return uploaded.id


def test_an_upload_writes_its_bytes_before_the_row_commits_and_a_rollback_keeps_no_row(
    http: TestClient, tmp_path: Path
) -> None:
    trip_id, _ = _trip_with_area(http)
    storage = LocalObjectStorage(str(tmp_path))

    with TestingSessionLocal() as session:
        _uploaded_document(session, storage, trip_id, b"private booking")
        written = [path for path in tmp_path.rglob("*") if path.is_file()]
        assert len(written) == 1  # rule 1: the bytes exist before anything commits
        session.rollback()
    with TestingSessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(DocumentAsset)) == 0
        assert session.scalar(select(func.count()).select_from(StoredObject)) == 0

    with TestingSessionLocal() as session:
        _uploaded_document(session, storage, trip_id, b"private booking")
        session.commit()
    with TestingSessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(DocumentAsset)) == 1
        # The rolled-back write left an unreferenced file (`reconcile-objects` removes it); the committed row names the other.
        assert len([path for path in tmp_path.rglob("*") if path.is_file()]) == 2
        assert session.scalar(select(func.count()).select_from(StoredObject)) == 1


def test_a_removal_deletes_the_bytes_only_after_the_caller_commits_the_purge_mark(
    http: TestClient, tmp_path: Path
) -> None:
    trip_id, _ = _trip_with_area(http)
    storage = LocalObjectStorage(str(tmp_path))
    with TestingSessionLocal() as session:
        document_id = _uploaded_document(session, storage, trip_id, b"private booking")
        session.commit()

    with TestingSessionLocal() as session:
        document_service.remove_document(session, "owner-1", trip_id, document_id)
        session.rollback()  # the caller gave up: nothing was marked, nothing was deleted
    with TestingSessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(DocumentAsset)) == 1
        assert session.scalars(select(StoredObject.state)).one() == ObjectState.AVAILABLE
        assert len([path for path in tmp_path.rglob("*") if path.is_file()]) == 1

    with TestingSessionLocal() as session:
        purge = document_service.remove_document(session, "owner-1", trip_id, document_id)
        session.commit()
        # Rule 3: the mark is committed, the bytes are still there until the purge runs.
        assert session.scalars(select(StoredObject.state)).one() == ObjectState.PURGE_PENDING
        assert len([path for path in tmp_path.rglob("*") if path.is_file()]) == 1
        purge.finalise(session, storage)
    with TestingSessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(StoredObject)) == 0
        assert [path for path in tmp_path.rglob("*") if path.is_file()] == []


def test_the_mcp_tool_finalises_a_removal_only_after_its_own_commit(
    http: TestClient, backend: TravelMcpBackend, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(mcp_core, "get_storage", lambda: LocalObjectStorage(str(tmp_path)))
    trip_id, _ = _trip_with_area(http)
    upload = BinaryUpload(filename="ticket.txt", content_type="text/plain", data_base64="cHJpdmF0ZSBib29raW5n")
    document = backend.upload_document(trip_id, "Ticket", DocumentKind.OTHER, upload)
    assert len([path for path in tmp_path.rglob("*") if path.is_file()]) == 1

    with pytest.raises(ValueError, match="confirm"):
        backend.delete_document(trip_id, document["id"])
    assert len([path for path in tmp_path.rglob("*") if path.is_file()]) == 1

    assert backend.delete_document(trip_id, document["id"], confirm=True) == {"status": "deleted"}
    assert [path for path in tmp_path.rglob("*") if path.is_file()] == []
    with TestingSessionLocal() as session:
        assert session.scalar(select(func.count()).select_from(StoredObject)) == 0


def test_a_visitor_who_finds_an_expired_collection_leaves_the_expiry_recorded(http: TestClient) -> None:
    trip_id, _ = _trip_with_area(http)
    collection_id = http.post("/api/collections", json={"label": "Family"}).json()["id"]
    assert http.post(f"/api/collections/{collection_id}/members", json={"trip_id": trip_id}).status_code == 201
    token = http.post(f"/api/collections/{collection_id}/activate", json={}).json()["token"]
    with TestingSessionLocal() as session:
        session.get(Collection, collection_id).expires_at = datetime.now(UTC) - timedelta(days=1)
        session.commit()

    assert http.get(f"/api/shared/{token}").status_code == 404

    with TestingSessionLocal() as session:
        assert session.get(Collection, collection_id).state == LinkState.EXPIRED
        kinds = list(
            session.scalars(
                select(CollectionAuditEvent.kind).where(CollectionAuditEvent.collection_id == collection_id)
            )
        )
    assert kinds.count("collection.expire") == 1


@pytest.mark.parametrize(
    ("http_path", "tool", "arguments", "field"),
    [
        ("/api/collections/{id}", "get_collection", {"collection_id": "{id}"}, "collection_id"),
        ("/api/trips/{id}/share-links", "list_share_links", {"trip_id": "{id}"}, "trip_id"),
        ("/api/trips/{id}/sharing-presets", "list_sharing_presets", {"trip_id": "{id}"}, "trip_id"),
    ],
)
def test_a_malformed_id_of_a_moved_feature_fails_the_same_way_through_the_tool_as_the_path(
    http: TestClient, http_path: str, tool: str, arguments: dict, field: str
) -> None:
    too_long = "x" * 33
    code = http_code(http.get(http_path.format(id=too_long)))

    async def run() -> object:
        async with Client(create_mcp_server(TestingSessionLocal)) as client:
            return await client.call_tool(
                tool, {key: value.format(id=too_long) for key, value in arguments.items()}, raise_on_error=False
            )

    result = asyncio.run(run())

    assert code == "too_long"
    assert result.is_error and f"{field}:{code}" in result.content[0].text
