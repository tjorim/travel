import asyncio
import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import main as app_main
from app import schemas
from app.config import settings
from app.database import Base
from app.mcp_server import (
    MCP_TOOL_CAPABILITIES,
    ToolFailureMiddleware,
    TravelMcpBackend,
    create_mcp_http_app,
    create_mcp_server,
    mcp_http_enabled,
)
from app.models import McpAuditEvent, Trip
from app.routers import trips as trips_router
from app.task_alerts import process_due_task_alerts

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


@event.listens_for(engine, "connect")
def enable_foreign_keys(dbapi_connection: object, _: object) -> None:
    dbapi_connection.execute("PRAGMA foreign_keys=ON")


def setup_function() -> None:
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


@pytest.fixture
def backend(monkeypatch: pytest.MonkeyPatch) -> TravelMcpBackend:
    monkeypatch.setattr(settings, "environment", "development")
    monkeypatch.setattr(settings, "mcp_development_subject", "owner-1")
    return TravelMcpBackend(TestingSessionLocal)


def test_owner_tools_use_application_validation_and_audit_each_result(backend: TravelMcpBackend) -> None:
    trip = backend.create_trip(schemas.TripCreate(title="Exampleland 2054", summary="Private"))

    with pytest.raises(ValueError, match="confirm=true"):
        backend.delete_trip(trip["id"])

    with TestingSessionLocal() as session:
        events = list(session.scalars(select(McpAuditEvent).order_by(McpAuditEvent.occurred_at)))
        assert [(event.action, event.result) for event in events] == [
            ("trip.create", "succeeded"),
            ("trip.delete", "rejected"),
        ]
        assert events[-1].owner_subject == "owner-1"
        assert events[-1].resource_id == trip["id"]
        assert "payload" not in events[-1].details


def test_delete_trip_retains_success_and_rejection_audits(backend: TravelMcpBackend) -> None:
    trip_id = backend.create_trip(schemas.TripCreate(title="Disposable"))["id"]

    assert backend.delete_trip(trip_id, confirm=True) == {"status": "deleted"}
    with pytest.raises(ValueError, match="Trip not found"):
        backend.delete_trip(trip_id, confirm=True)

    with TestingSessionLocal() as session:
        assert session.get(Trip, trip_id) is None
        events = list(session.scalars(
            select(McpAuditEvent).where(McpAuditEvent.action == "trip.delete")
            .order_by(McpAuditEvent.occurred_at, McpAuditEvent.id)
        ))
        assert sorted((event.result, event.trip_id) for event in events) == [
            ("rejected", trip_id), ("succeeded", trip_id),
        ]


def test_committed_delete_is_reported_successful_if_audit_write_fails(
    backend: TravelMcpBackend, monkeypatch: pytest.MonkeyPatch,
) -> None:
    trip_id = backend.create_trip(schemas.TripCreate(title="Disposable"))["id"]

    def fail_audit(*_: object, **__: object) -> None:
        raise RuntimeError("audit unavailable")

    monkeypatch.setattr(backend, "_audit", fail_audit)
    assert backend.delete_trip(trip_id, confirm=True) == {"status": "deleted"}
    with pytest.raises(ValueError, match="Trip not found"):
        backend.delete_trip(trip_id, confirm=True)
    with TestingSessionLocal() as session:
        assert session.get(Trip, trip_id) is None


def test_mcp_cannot_cross_owner_boundary(backend: TravelMcpBackend, monkeypatch: pytest.MonkeyPatch) -> None:
    trip = backend.create_trip(schemas.TripCreate(title="Exampleland 2054"))
    monkeypatch.setattr(settings, "mcp_development_subject", "owner-2")

    with pytest.raises(ValueError, match="Trip not found"):
        backend.get_trip(trip["id"])

    with TestingSessionLocal() as session:
        rejected = session.scalar(
            select(McpAuditEvent).where(McpAuditEvent.owner_subject == "owner-2", McpAuditEvent.action == "trip.get")
        )
        assert rejected is not None
        assert rejected.result == "rejected"


def test_registered_tools_cover_owner_resource_families(backend: TravelMcpBackend) -> None:
    async def names() -> set[str]:
        return {tool.name for tool in await create_mcp_server(TestingSessionLocal).list_tools()}

    registered = asyncio.run(names())
    assert {
        "create_trip",
        "save_exact_place",
        "save_broad_place",
        "create_route_stage",
        "create_moment",
        "create_moment_excerpt",
        "create_stay",
        "get_stay",
        "create_trip_highlight",
        "delete_trip_highlight",
        "create_broad_stay_card",
        "get_broad_stay_card",
        "upload_finished_track",
        "get_recorded_track",
        "create_broad_route",
        "get_broad_route",
        "upload_document",
        "get_document",
        "add_document_derivative",
        "upload_media",
        "get_media",
        "create_media_derivative",
        "preview_public_projection",
        "preview_public_navigation",
        "inspect_public_preview_file",
        "activate_share_link",
        "preview_share_navigation",
        "inspect_share_preview_file",
    } <= registered
    assert not any("sql" in tool or "filesystem" in tool or "http" in tool for tool in registered)


def test_fastmcp_invokes_a_typed_tool_against_the_real_owner_handler(backend: TravelMcpBackend) -> None:
    async def create_through_protocol() -> object:
        return await create_mcp_server(TestingSessionLocal).call_tool(
            "create_trip", {"payload": {"title": "Protocol trip"}}
        )

    result = asyncio.run(create_through_protocol())
    assert not result.is_error
    assert result.structured_content["title"] == "Protocol trip"
    assert result.structured_content["owner_subject"] == "owner-1"


def test_mcp_can_schedule_and_read_a_task_alert(backend: TravelMcpBackend) -> None:
    trip_id = backend.create_trip(schemas.TripCreate(title="Exampleland 2054"))["id"]
    task = backend.create_trip_task(trip_id, schemas.TripTaskCreate(
        title="Check train tickets", remind_at=datetime(2054, 11, 1, 8, tzinfo=UTC),
    ))
    with TestingSessionLocal() as session:
        assert process_due_task_alerts(session, datetime(2054, 11, 1, 9, tzinfo=UTC)) == 1
    alerts = backend.list_task_alerts(trip_id)
    assert len(alerts) == 1
    assert alerts[0]["task_id"] == task["id"]
    assert backend.mark_task_alert_read(trip_id, alerts[0]["id"])["read_at"] is not None


def test_http_mcp_factory_requires_oidc_and_builds_a_stateless_app(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "mcp_base_url", None)
    monkeypatch.setattr(settings, "oidc_issuer_url", None)
    assert not mcp_http_enabled()
    with pytest.raises(RuntimeError, match="MCP HTTP requires"):
        create_mcp_http_app(TestingSessionLocal)

    monkeypatch.setattr(settings, "mcp_base_url", "https://mcp.example.test/mcp")
    monkeypatch.setattr(settings, "oidc_issuer_url", "https://identity.example.test/realms/travel")
    assert mcp_http_enabled()
    server, http_app = create_mcp_http_app(TestingSessionLocal)
    assert server.name == "travel"
    assert http_app is not None


def test_highlight_tools_use_the_owner_handlers_and_require_confirmation_to_delete(backend: TravelMcpBackend) -> None:
    trip = backend.create_trip(schemas.TripCreate(title="Highlights"))
    second = backend.create_trip_highlight(trip["id"], schemas.TripHighlightCreate(title="Mountains"))
    first = backend.create_trip_highlight(trip["id"], schemas.TripHighlightCreate(title="City", position=0))
    assert [item["title"] for item in backend.list_trip_highlights(trip["id"])] == ["City", "Mountains"]
    assert backend.update_trip_highlight(trip["id"], second["id"], schemas.TripHighlightUpdate(summary="Alishan."))["summary"] == "Alishan."
    with pytest.raises(ValueError, match="confirm=true"):
        backend.delete_trip_highlight(trip["id"], first["id"])
    assert backend.delete_trip_highlight(trip["id"], first["id"], confirm=True) == {"status": "deleted"}
    assert [item["title"] for item in backend.list_trip_highlights(trip["id"])] == ["Mountains"]


def _protocol_client(factory: sessionmaker = TestingSessionLocal) -> Client:
    return Client(create_mcp_server(factory))


def test_parallel_list_calls_all_succeed_and_are_each_audited(
    backend: TravelMcpBackend, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    file_engine = create_engine(f"sqlite:///{tmp_path / 'mcp.db'}", connect_args={"timeout": 30})
    Base.metadata.create_all(file_engine)
    factory = sessionmaker(bind=file_engine, autocommit=False, autoflush=False)
    tools = ["list_exact_places", "list_broad_places", "list_documents", "list_media", "list_share_links",
             "list_stays", "list_transport_legs", "list_trip_tasks", "list_itinerary_entries"]

    async def run() -> list[object]:
        async with _protocol_client(factory) as client:
            trip_id = (await client.call_tool("create_trip", {"payload": {"title": "Parallel"}})).structured_content["id"]
            return await asyncio.gather(*(
                client.call_tool(tools[index % len(tools)], {"trip_id": trip_id}, raise_on_error=False)
                for index in range(45)
            ), return_exceptions=True)

    results = asyncio.run(run())
    assert [result for result in results if isinstance(result, Exception) or result.is_error] == []
    with factory() as session:
        events = list(session.scalars(select(McpAuditEvent)))
    assert sorted(event.result for event in events) == ["succeeded"] * 46
    assert all(event.details.get("request_id") for event in events)


def test_response_validation_failure_is_a_correlated_tool_error_audited_once(
    backend: TravelMcpBackend, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    async def run() -> object:
        async with _protocol_client() as client:
            trip_id = (await client.call_tool("create_trip", {"payload": {"title": "Broken"}})).structured_content["id"]
            monkeypatch.setattr(trips_router, "get_trip", lambda *_: {"id": trip_id, "title": "SECRET-PRIVATE-NOTE"})
            return await client.call_tool("get_trip", {"trip_id": trip_id}, raise_on_error=False)

    with caplog.at_level(logging.INFO):
        result = asyncio.run(run())

    assert result.is_error
    message = result.content[0].text
    assert "get_trip failed validation" in message and "Reference:" in message
    with TestingSessionLocal() as session:
        rejected = list(session.scalars(select(McpAuditEvent).where(McpAuditEvent.result == "rejected")))
    assert len(rejected) == 1
    assert rejected[0].action == "trip.get"
    assert rejected[0].details["request_id"] in message
    assert "SECRET-PRIVATE-NOTE" not in json.dumps(rejected[0].details) + caplog.text + message


def test_invalid_arguments_are_audited_without_the_payload(
    backend: TravelMcpBackend, caplog: pytest.LogCaptureFixture
) -> None:
    async def run() -> object:
        async with _protocol_client() as client:
            return await client.call_tool(
                "create_trip", {"payload": {"title": "SECRET-TITLE", "starts_on": "not-a-date"}}, raise_on_error=False
            )

    result = asyncio.run(run())
    assert result.is_error
    with TestingSessionLocal() as session:
        events = list(session.scalars(select(McpAuditEvent)))
    assert [(event.action, event.result, event.resource_type) for event in events] == [
        ("create_trip", "rejected", "tool_invocation")
    ]
    assert "SECRET-TITLE" not in json.dumps(events[0].details)


def test_unknown_tools_are_not_audited_and_keep_their_specific_error(backend: TravelMcpBackend) -> None:
    async def run() -> object:
        async with _protocol_client() as client:
            return await client.call_tool("no_such_tool", {}, raise_on_error=False)

    result = asyncio.run(run())
    assert result.is_error and "Unknown tool" in result.content[0].text
    with TestingSessionLocal() as session:
        assert list(session.scalars(select(McpAuditEvent))) == []


def test_tool_errors_carry_the_reference_that_is_in_the_audit_row(backend: TravelMcpBackend) -> None:
    async def run() -> object:
        async with _protocol_client() as client:
            return await client.call_tool("get_trip", {"trip_id": "missing"}, raise_on_error=False)

    result = asyncio.run(run())
    assert result.is_error and "Trip not found" in result.content[0].text
    with TestingSessionLocal() as session:
        rejected = session.scalars(select(McpAuditEvent)).one()
    assert (rejected.action, rejected.result) == ("trip.get", "rejected")
    assert f"Reference: {rejected.details['request_id']}" in result.content[0].text


def test_an_unexpected_exception_type_becomes_a_correlated_tool_error(backend: TravelMcpBackend) -> None:
    middleware = ToolFailureMiddleware(backend)
    context = SimpleNamespace(message=SimpleNamespace(name="list_trips", arguments={}))

    async def fail(_: object) -> None:
        raise RuntimeError("SECRET")

    with pytest.raises(ToolError, match=r"list_trips hit an unexpected RuntimeError\. Reference: None") as raised:
        asyncio.run(middleware.on_call_tool(context, fail))
    assert "SECRET" not in str(raised.value)
    with TestingSessionLocal() as session:
        assert session.scalars(select(McpAuditEvent)).one().resource_type == "tool_invocation"


def test_capability_manifest_covers_every_registered_tool_with_consistent_annotations(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    server = create_mcp_server(TestingSessionLocal)
    registered = {tool.name: tool for tool in asyncio.run(server.list_tools())}
    monkeypatch.setattr(app_main, "_mcp_app", object())
    monkeypatch.setattr(app_main, "_mcp", SimpleNamespace(version="test"))

    manifest = app_main.mcp_capabilities()

    assert manifest["contract_version"] == 1
    assert manifest["enabled"] is True
    assert manifest["mount_path"] == "/mcp"
    tools = manifest["tools"]
    assert [tool["name"] for tool in tools] == sorted(registered)
    assert set(registered) == set(MCP_TOOL_CAPABILITIES)
    for tool in tools:
        assert set(tool) == {"name", "effect", "requires_confirmation", "access"}
        assert tool["effect"] in {"read", "write"}
        assert isinstance(tool["requires_confirmation"], bool)
        assert tool["access"] == {}
        annotations = registered[tool["name"]].annotations
        assert annotations is not None
        assert annotations.read_only_hint is (tool["effect"] == "read")
        assert annotations.destructive_hint is not None
        assert annotations.idempotent_hint is not None
        assert annotations.open_world_hint is not None


def test_capability_manifest_reports_contract_version_when_mcp_is_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(app_main, "_mcp_app", None)
    monkeypatch.setattr(app_main, "_mcp", None)

    assert app_main.mcp_capabilities() == {
        "contract_version": 1,
        "enabled": False,
        "mount_path": "/mcp",
        "version": None,
        "tools": [],
        "resources": [],
        "prompts": [],
    }
