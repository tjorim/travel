import asyncio
import base64
import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from fastmcp import Client, FastMCP
from fastmcp.exceptions import ToolError
from fastmcp.server.auth.providers.jwt import RSAKeyPair
from fastmcp.tools.base import Tool
from fastmcp.utilities.json_schema import dereference_refs
from pydantic import ValidationError
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import main as app_main
from app import schemas
from app.config import Settings, settings
from app.database import Base
from app.mcp_server import (
    MCP_AGENT_READ_TOOLS,
    MCP_DELEGATED_TOOLS,
    MCP_TOOL_CAPABILITIES,
    ToolFailureMiddleware,
    TravelMcpBackend,
    _unauthorized_reason,
    create_mcp_http_app,
    create_mcp_server,
    delegation_refusal,
    mcp_http_enabled,
    mount_mcp,
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
        events = list(
            session.scalars(
                select(McpAuditEvent)
                .where(McpAuditEvent.action == "trip.delete")
                .order_by(McpAuditEvent.occurred_at, McpAuditEvent.id)
            )
        )
        assert sorted((event.result, event.trip_id) for event in events) == [
            ("rejected", trip_id),
            ("succeeded", trip_id),
        ]


def test_committed_delete_is_reported_successful_if_audit_write_fails(
    backend: TravelMcpBackend,
    monkeypatch: pytest.MonkeyPatch,
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


def _registered_tools(server: FastMCP) -> dict[str, Tool]:
    """The full catalogue, including the tools only reachable through search_tools and call_tool."""

    async def catalogue() -> dict[str, Tool]:
        tools = {name: await server.get_tool(name) for name in MCP_TOOL_CAPABILITIES}
        return {name: tool for name, tool in tools.items() if tool is not None}

    return asyncio.run(catalogue())


def test_registered_tools_cover_owner_resource_families(backend: TravelMcpBackend) -> None:
    registered = set(_registered_tools(create_mcp_server(TestingSessionLocal)))
    assert {
        "create_trip",
        "save_location",
        "save_area",
        "create_visit",
        "create_travel_update",
        "create_stay",
        "get_stay",
        "update_travel_update",
        "delete_travel_update",
        "set_visibility",
        "update_location",
        "create_route",
        "get_route",
        "upload_document",
        "get_document",
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
    task = backend.create_trip_task(
        trip_id,
        schemas.TripTaskCreate(
            title="Check train tickets",
            remind_at=datetime(2054, 11, 1, 8, tzinfo=UTC),
        ),
    )
    with TestingSessionLocal() as session:
        assert process_due_task_alerts(session, datetime(2054, 11, 1, 9, tzinfo=UTC)) == 1
    alerts = backend.list_task_alerts(trip_id)
    assert len(alerts) == 1
    assert alerts[0]["task_id"] == task["id"]
    assert backend.mark_task_alert_read(trip_id, alerts[0]["id"])["read_at"] is not None


def test_mcp_share_activation_and_rotation_return_complete_visitor_urls(
    backend: TravelMcpBackend,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "public_app_url", "https://travel.example.test/")
    trip = backend.create_trip(schemas.TripCreate(title="Shareable"))
    link = backend.create_share_link(trip["id"], schemas.ShareLinkCreate(label="Family"), confirm=True)

    activated = backend.activate_share_link(trip["id"], link["id"], schemas.ShareLinkActivateRequest(), confirm=True)
    assert activated["share_url"] == f"https://travel.example.test/share/{activated['token']}"

    rotated = backend.rotate_share_link(trip["id"], link["id"], schemas.ShareLinkActivateRequest(), confirm=True)
    assert rotated["share_url"] == f"https://travel.example.test/share/{rotated['token']}"


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


def test_http_mcp_logs_why_a_request_was_refused_without_the_token(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(settings, "mcp_base_url", "https://mcp.example.test/mcp")
    monkeypatch.setattr(settings, "oidc_issuer_url", "https://identity.example.test/realms/travel")
    _, http_app = create_mcp_http_app(TestingSessionLocal)
    client = TestClient(http_app)
    with caplog.at_level(logging.WARNING, logger="app.mcp_server"):
        assert client.post("/", json={}).status_code == 401
        assert client.post("/", json={}, headers={"Authorization": "Basic SECRET-CREDENTIAL"}).status_code == 401
    assert "MCP POST / rejected with 401: no Authorization header" in caplog.text
    assert "rejected with 401: Authorization header is not a Bearer token" in caplog.text
    assert "SECRET-CREDENTIAL" not in caplog.text


ISSUER = "https://identity.example.test/realms/travel"
MCP_URL = "https://travel.example.test/mcp"
MCP_HEADERS = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}
WHOAMI_CALL = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "whoami", "arguments": {}}}


@pytest.fixture
def mcp_resource(monkeypatch: pytest.MonkeyPatch) -> tuple[FastAPI, RSAKeyPair]:
    """The production mount: Keycloak-verified MCP below ``/mcp`` of the real FastAPI app shape."""
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "oidc_audience", "travel-api")
    monkeypatch.setattr(settings, "oidc_issuer_url", ISSUER)
    monkeypatch.setattr(settings, "mcp_base_url", MCP_URL)
    monkeypatch.setattr(settings, "mcp_audience", None)
    server, http_app = create_mcp_http_app(TestingSessionLocal)
    pair = RSAKeyPair.generate()
    # Only the key lookup is replaced; issuer, audience, expiry and scope checks are the production verifier's.
    server.auth.token_verifier.public_key = pair.public_key
    application = FastAPI(lifespan=http_app.lifespan)
    mount_mcp(application, server, http_app)
    return application, pair


def _bearer(pair: RSAKeyPair, **claims: object) -> dict[str, str]:
    options = {"subject": "owner-9", "issuer": ISSUER, "audience": MCP_URL, "scopes": ["openid"]} | claims
    return {"Authorization": f"Bearer {pair.create_token(**options)}", **MCP_HEADERS}


def test_mcp_publishes_its_canonical_resource_and_keycloak_as_the_authorization_server(
    mcp_resource: tuple[FastAPI, RSAKeyPair],
) -> None:
    application, _ = mcp_resource
    with TestClient(application, base_url="https://travel.example.test") as client:
        metadata = client.get("/.well-known/oauth-protected-resource/mcp")
        challenge = client.post("/mcp", json=WHOAMI_CALL, headers=MCP_HEADERS, follow_redirects=True)

    assert metadata.status_code == 200
    assert metadata.json()["resource"] == MCP_URL
    assert metadata.json()["authorization_servers"] == [ISSUER]
    assert challenge.status_code == 401
    assert (
        'resource_metadata="https://travel.example.test/.well-known/oauth-protected-resource/mcp"'
        in challenge.headers["www-authenticate"]
    )


def test_mcp_tool_call_with_the_dedicated_audience_acts_as_the_token_subject(
    mcp_resource: tuple[FastAPI, RSAKeyPair],
) -> None:
    application, pair = mcp_resource
    with TestClient(application, base_url="https://travel.example.test") as client:
        called = client.post("/mcp/", json=WHOAMI_CALL, headers=_bearer(pair))
        # Keycloak may list several audiences; the MCP resource being one of them is enough.
        listed = client.post("/mcp/", json=WHOAMI_CALL, headers=_bearer(pair, audience=["account", MCP_URL]))

    assert called.status_code == listed.status_code == 200
    assert '"subject":"owner-9"' in called.text.replace('\\"', '"').replace(" ", "")


@pytest.mark.parametrize(
    "claims",
    [
        pytest.param({"audience": "travel-api"}, id="api-audience-only"),
        pytest.param({"audience": "https://worktime.example.test/mcp"}, id="another-mcp-resource"),
        pytest.param({"audience": f"{MCP_URL}/"}, id="resource-with-trailing-slash"),
        pytest.param({"audience": ["travel-api", "account"]}, id="audience-list-without-mcp"),
        pytest.param({"audience": None}, id="no-audience"),
        pytest.param({"issuer": "https://identity.example.test/realms/other"}, id="wrong-issuer"),
        pytest.param({"expires_in_seconds": -60}, id="expired"),
        pytest.param({"scopes": ["profile"]}, id="missing-openid-scope"),
    ],
)
def test_mcp_rejects_signed_tokens_that_are_not_for_this_resource(
    mcp_resource: tuple[FastAPI, RSAKeyPair], claims: dict[str, object]
) -> None:
    application, pair = mcp_resource
    with TestClient(application, base_url="https://travel.example.test") as client:
        refused = client.post("/mcp/", json=WHOAMI_CALL, headers=_bearer(pair, **claims))

    assert refused.status_code == 401
    assert "owner-9" not in refused.text


def test_mcp_rejects_a_token_signed_by_another_key(mcp_resource: tuple[FastAPI, RSAKeyPair]) -> None:
    application, _ = mcp_resource
    with TestClient(application, base_url="https://travel.example.test") as client:
        refused = client.post("/mcp/", json=WHOAMI_CALL, headers=_bearer(RSAKeyPair.generate()))

    assert refused.status_code == 401


def test_a_rejected_mcp_token_leaves_no_audit_row(mcp_resource: tuple[FastAPI, RSAKeyPair]) -> None:
    application, pair = mcp_resource
    with TestClient(application, base_url="https://travel.example.test") as client:
        assert client.post("/mcp/", json=WHOAMI_CALL, headers=_bearer(pair, audience="travel-api")).status_code == 401
        trips = {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "list_trips", "arguments": {}}}
        assert client.post("/mcp/", json=trips, headers=_bearer(pair)).status_code == 200

    with TestingSessionLocal() as session:
        assert {event.owner_subject for event in session.scalars(select(McpAuditEvent))} == {"owner-9"}


def test_mcp_audience_defaults_to_the_canonical_url_and_never_the_api_audience(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configured = Settings(mcp_base_url="https://travel.example.test/mcp/", oidc_audience="travel-api")
    assert configured.mcp_resource_url == MCP_URL
    assert configured.mcp_token_audience == MCP_URL
    assert Settings(mcp_base_url=MCP_URL, mcp_audience="travel-mcp").mcp_token_audience == "travel-mcp"
    assert Settings().mcp_token_audience is None
    with pytest.raises(ValidationError, match="TRAVEL_MCP_AUDIENCE must differ"):
        Settings(mcp_base_url=MCP_URL, mcp_audience="travel-api", oidc_audience="travel-api")


def test_unauthorized_reason_names_unverified_claims_but_never_the_token() -> None:
    def segment(value: dict[str, object]) -> str:
        return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")

    token = ".".join(
        [
            segment({"alg": "RS256", "kid": "key-1"}),
            segment({"iss": "https://identity.example.test/realms/travel", "aud": "travel", "azp": "claude", "exp": 1}),
            "SECRET-SIGNATURE",
        ]
    )
    reason = _unauthorized_reason(f"Bearer {token}")
    assert "kid='key-1'" in reason and "azp='claude'" in reason and "aud='travel'" in reason
    assert "expires_in=-" in reason
    assert token not in reason and "SECRET-SIGNATURE" not in reason
    assert _unauthorized_reason("Bearer not-a-jwt") == "bearer token is not a JWT (1 segments)"
    assert _unauthorized_reason("Bearer a.%%%.c") == "bearer token has an undecodable JWT header or payload"


def test_travel_update_tools_use_the_owner_handlers_and_require_confirmation_to_delete(
    backend: TravelMcpBackend,
) -> None:
    trip = backend.create_trip(schemas.TripCreate(title="Updates"))
    created = backend.create_travel_update(
        trip["id"], schemas.TravelUpdateCreate(occurred_at="2054-04-04T10:00:00Z", title="Arrival", body="We landed.")
    )
    assert created["visibility"] == "private"
    edited = backend.update_travel_update(trip["id"], created["id"], schemas.TravelUpdatePatch(visibility="everyone"))
    assert edited["visibility"] == "everyone"
    with pytest.raises(ValueError, match="confirm=true"):
        backend.delete_travel_update(trip["id"], created["id"])
    assert backend.delete_travel_update(trip["id"], created["id"], confirm=True) == {"status": "deleted"}


def test_set_visibility_tool_needs_confirmation_and_uses_the_owner_rules(backend: TravelMcpBackend) -> None:
    trip = backend.create_trip(schemas.TripCreate(title="Sharing"))
    location = backend.save_location(trip["id"], schemas.LocationInput(display_name="Hotel, 1 Main Street"))
    with pytest.raises(ValueError, match="confirm=true"):
        backend.set_visibility(trip["id"], "location", location["id"], "everyone")
    # A location cannot be shared without a public name, whoever asks.
    with pytest.raises(ValueError, match="public name"):
        backend.set_visibility(trip["id"], "location", location["id"], "everyone", confirm=True)
    backend.update_location(trip["id"], location["id"], schemas.LocationUpdate(label="Riverside lookout"))
    assert backend.set_visibility(trip["id"], "location", location["id"], "everyone", confirm=True) == {
        "visibility": "everyone"
    }
    assert backend.list_locations(trip["id"])[0]["visibility"] == "everyone"


def _protocol_client(factory: sessionmaker = TestingSessionLocal) -> Client:
    return Client(create_mcp_server(factory))


def test_parallel_list_calls_all_succeed_and_are_each_audited(
    backend: TravelMcpBackend, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    file_engine = create_engine(f"sqlite:///{tmp_path / 'mcp.db'}", connect_args={"timeout": 30})
    Base.metadata.create_all(file_engine)
    factory = sessionmaker(bind=file_engine, autocommit=False, autoflush=False)
    tools = [
        "list_locations",
        "list_areas",
        "list_documents",
        "list_media",
        "list_share_links",
        "list_stays",
        "list_routes",
        "list_trip_tasks",
        "list_visits",
    ]

    async def run() -> list[object]:
        async with _protocol_client(factory) as client:
            trip_id = (await client.call_tool("create_trip", {"payload": {"title": "Parallel"}})).structured_content[
                "id"
            ]
            return await asyncio.gather(
                *(
                    client.call_tool(tools[index % len(tools)], {"trip_id": trip_id}, raise_on_error=False)
                    for index in range(45)
                ),
                return_exceptions=True,
            )

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
    arguments = {"payload": {"title": "Exampleland", "starts_on": "SECRET-DATE"}}

    async def run() -> list[object]:
        async with _protocol_client() as client:
            direct = await client.call_tool("create_trip", arguments, raise_on_error=False)
            proxied = await client.call_tool(
                "call_tool", {"name": "create_trip", "arguments": arguments}, raise_on_error=False
            )
            return [direct, proxied]

    with caplog.at_level(logging.INFO):
        results = asyncio.run(run())
    for result in results:
        assert result.is_error
        message = result.content[0].text
        assert "payload.starts_on" in message and "Reference:" in message
        assert "SECRET-DATE" not in message and "input_value" not in message
    with TestingSessionLocal() as session:
        events = list(session.scalars(select(McpAuditEvent)))
    assert [(event.action, event.result, event.resource_type) for event in events] == [
        ("create_trip", "rejected", "tool_invocation")
    ] * 2
    assert "SECRET-DATE" not in json.dumps([event.details for event in events]) + caplog.text


def test_an_unknown_field_is_a_rejection_naming_it_and_the_value_is_not_audited(
    backend: TravelMcpBackend, caplog: pytest.LogCaptureFixture
) -> None:
    async def run() -> object:
        async with _protocol_client() as client:
            trip_id = (await client.call_tool("create_trip", {"payload": {"title": "Exampleland"}})).structured_content["id"]
            area = await client.call_tool("save_area", {"trip_id": trip_id, "payload": {"label": "Taipei"}})
            visit = await client.call_tool(
                "create_visit", {"trip_id": trip_id, "payload": {"area_id": area.structured_content["id"]}}
            )
            return await client.call_tool(
                "update_visit",
                {
                    "trip_id": trip_id,
                    "visit_id": visit.structured_content["id"],
                    "payload": {"title": "Temple", "state": "SECRET-STATE"},
                },
                raise_on_error=False,
            )

    with caplog.at_level(logging.INFO):
        result = asyncio.run(run())

    assert result.is_error
    assert "payload.state:extra_forbidden" in result.content[0].text
    assert "SECRET-STATE" not in result.content[0].text
    with TestingSessionLocal() as session:
        rejected = session.scalars(select(McpAuditEvent).where(McpAuditEvent.result == "rejected")).one()
    assert (rejected.action, rejected.resource_type) == ("update_visit", "tool_invocation")
    assert rejected.details["error"] == "Validation failed (payload.state:extra_forbidden)"
    assert "SECRET-STATE" not in json.dumps(rejected.details) + caplog.text


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
    registered = _registered_tools(server)
    monkeypatch.setattr(app_main, "_mcp_app", object())
    monkeypatch.setattr(app_main, "_mcp", SimpleNamespace(version="test"))

    manifest = app_main.mcp_capabilities()

    assert manifest["contract_version"] == 1
    assert manifest["enabled"] is True
    assert manifest["mount_path"] == "/mcp"
    tools = manifest["tools"]
    assert [tool["name"] for tool in tools] == sorted(registered)
    assert set(registered) == set(MCP_TOOL_CAPABILITIES)
    assert manifest["visible_tools"] == ["whoami", "list_trips", "get_trip_overview", "search_tools", "call_tool"]
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
        "visible_tools": [],
        "resources": [],
        "prompts": [],
    }


def test_write_tool_destructive_hints_reflect_overwrites() -> None:
    from app.mcp_server import _ADDITIVE_WRITE_TOOLS, _tool_annotations

    write_tools = {name for name, cap in MCP_TOOL_CAPABILITIES.items() if cap["effect"] == "write"}
    assert write_tools >= _ADDITIVE_WRITE_TOOLS
    for name in write_tools:
        destructive = _tool_annotations(name).destructive_hint
        if name.startswith(("delete_", "update_", "revoke_", "unpublish_")):
            assert destructive is True, name
        if name.startswith("create_"):
            assert destructive is False, name
    # Overwrite/revoke tools whose names carry no destructive prefix.
    assert _tool_annotations("set_public_projection_scope").destructive_hint is True
    assert _tool_annotations("rotate_share_link").destructive_hint is True
    # Additive state advances stay non-destructive.
    assert _tool_annotations("activate_share_link").destructive_hint is False
    assert _tool_annotations("save_location").destructive_hint is False
    # Reads are never destructive, and no write tool is advertised as idempotent.
    assert _tool_annotations("get_trip").destructive_hint is False
    assert all(_tool_annotations(n).idempotent_hint is False for n in write_tools)


def test_preview_file_inspection_tools_are_read_only() -> None:
    from app.mcp_server import _tool_annotations

    for name in ("inspect_public_preview_file", "inspect_share_preview_file"):
        assert MCP_TOOL_CAPABILITIES[name]["effect"] == "read", name
        annotations = _tool_annotations(name)
        assert annotations.read_only_hint is True, name
        assert annotations.destructive_hint is False, name


def test_external_provider_tools_are_open_world() -> None:
    from app.mcp_server import _tool_annotations

    for name in (
        "search_places",
        "reverse_geocode_place",
        "start_media_import_session",
        "complete_media_import_session",
    ):
        assert _tool_annotations(name).open_world_hint is True, name
    assert _tool_annotations("list_trips").open_world_hint is False


def test_list_tools_are_compact_by_default_and_areas_can_be_found_by_name(backend: TravelMcpBackend) -> None:
    trip = backend.create_trip(schemas.TripCreate(title="Compact"))
    taipei = backend.save_area(
        trip["id"], schemas.AreaInput(label="Taipei", country_code="TW", latitude=25.03, longitude=121.56)
    )
    tainan = backend.save_area(trip["id"], schemas.AreaInput(label="Tainan · concept", country_code="TW"))
    backend.create_route(
        trip["id"],
        schemas.RouteCreate(
            mode="flight",
            departure_location=schemas.LocationInput(display_name="Taoyuan Airport", area_id=taipei["id"]),
            arrival_area_id=taipei["id"],
            notes="Seat 12A",
        ),
    )
    backend.create_stay(
        trip["id"], schemas.StayCreate(area_id=taipei["id"], check_in_date="2054-11-17", check_out_date="2054-11-18")
    )

    idea = backend.create_stay(
        trip["id"],
        schemas.StayCreate(
            area_id=taipei["id"], check_in_date="2054-11-17", check_out_date="2054-11-18", status="idea"
        ),
    )
    assert idea["status"] == "idea"
    assert backend.update_stay(trip["id"], idea["id"], schemas.StayUpdate(status="planned"))["status"] == "planned"
    assert backend.update_stay(trip["id"], idea["id"], schemas.StayUpdate(status="idea"))["status"] == "idea"
    assert backend.get_stay(trip["id"], idea["id"])["status"] == "idea"
    assert sorted(stay["status"] for stay in backend.list_stays(trip["id"])) == ["idea", "planned"]
    backend.delete_stay(trip["id"], idea["id"], confirm=True)

    candidate = backend.create_route(
        trip["id"],
        schemas.RouteCreate(mode="train", status="idea", departure_area_id=taipei["id"], arrival_area_id=tainan["id"]),
    )
    assert candidate["status"] == "idea"
    updated = backend.update_route(trip["id"], candidate["id"], schemas.RouteUpdate(status="planned"))
    assert updated["status"] == "planned"
    assert backend.get_route(trip["id"], candidate["id"])["status"] == "planned"
    backend.delete_route(trip["id"], candidate["id"], confirm=True)

    (route,) = backend.list_routes(trip["id"])
    assert route["departure_area"] == {"id": taipei["id"], "label": "Taipei"}
    assert route["departure_location_id"] and route["arrival_location_id"] is None
    assert "notes" not in route and "geometry" not in route and route["has_geometry"] is False
    (stay,) = backend.list_stays(trip["id"])
    assert stay["area"] == {"id": taipei["id"], "label": "Taipei"} and "contact_details" not in stay
    assert "viewport_north" not in backend.list_locations(trip["id"])[0]
    # The full records remain one argument away.
    assert backend.list_routes(trip["id"], compact=False)[0]["notes"] == "Seat 12A"
    assert backend.list_stays(trip["id"], compact=False)[0]["location"]["area_id"] == taipei["id"]

    assert [area["label"] for area in backend.list_areas(trip["id"], query="TAIN")] == ["Tainan · concept"]
    assert backend.list_areas(trip["id"], query="Taipei") == [
        {
            "id": taipei["id"],
            "label": "Taipei",
            "country_code": "TW",
            "region": None,
            "timezone": None,
            "visibility": "private",
        }
    ]


def test_batch_create_adds_everything_or_nothing(backend: TravelMcpBackend) -> None:
    from app.mcp_server import BatchCreate

    trip = backend.create_trip(schemas.TripCreate(title="Batch"))
    taipei = backend.save_area(trip["id"], schemas.AreaInput(label="Taipei"))
    tainan = backend.save_area(trip["id"], schemas.AreaInput(label="Tainan"))
    batch = BatchCreate(
        visits=[schemas.VisitCreate(area_id=tainan["id"], title="Old town", starts_on="2054-12-01")],
        stays=[
            schemas.StayCreate(
                area_id=tainan["id"], check_in_date="2054-12-01", check_out_date="2054-12-03", status="idea"
            )
        ],
        routes=[schemas.RouteCreate(mode="train", departure_area_id=taipei["id"], arrival_area_id=tainan["id"])] * 2,
        travel_updates=[
            schemas.TravelUpdateCreate(occurred_at="2054-12-01T12:00:00Z", title="Arrived", area_id=tainan["id"])
        ],
        trip_tasks=[schemas.TripTaskCreate(title="Book the hotel")],
    )
    created = backend.batch_create(trip["id"], batch)
    assert {field: len(rows) for field, rows in created.items()} == {
        "visits": 1,
        "stays": 1,
        "routes": 2,
        "travel_updates": 1,
        "trip_tasks": 1,
    }
    assert created["routes"][0]["arrival_area"]["label"] == "Tainan"
    assert backend.list_stays(trip["id"])[0]["status"] == "idea"
    assert created["trip_tasks"][0]["title"] == "Book the hotel"

    # One refused record keeps the whole batch out, and the error names it.
    refused = BatchCreate(
        visits=[schemas.VisitCreate(area_id=taipei["id"], title="Should not stay")],
        routes=[schemas.RouteCreate(mode="train", departure_area_id=taipei["id"], arrival_area_id="unknown-area")],
    )
    with pytest.raises(ValueError, match=r"routes\[0\].*Nothing was created"):
        backend.batch_create(trip["id"], refused)
    assert len(backend.list_visits(trip["id"])) == 1
    assert len(backend.list_routes(trip["id"])) == 2
    with TestingSessionLocal() as session:
        results = [
            event.result
            for event in session.scalars(select(McpAuditEvent).where(McpAuditEvent.action == "trip.batch_create"))
        ]
    assert sorted(results) == ["rejected", "succeeded"]


def test_route_tools_refuse_a_route_between_the_same_place(backend: TravelMcpBackend) -> None:
    trip = backend.create_trip(schemas.TripCreate(title="Same place"))
    taipei = backend.save_area(trip["id"], schemas.AreaInput(label="Taipei"))
    tainan = backend.save_area(trip["id"], schemas.AreaInput(label="Tainan"))

    with pytest.raises(ValueError, match="departure and arrival are the same"):
        backend.create_route(
            trip["id"], schemas.RouteCreate(mode="train", departure_area_id=taipei["id"], arrival_area_id=taipei["id"])
        )
    route = backend.create_route(
        trip["id"], schemas.RouteCreate(mode="train", departure_area_id=taipei["id"], arrival_area_id=tainan["id"])
    )
    with pytest.raises(ValueError, match="departure and arrival are the same"):
        backend.update_route(trip["id"], route["id"], schemas.RouteUpdate(arrival_area_id=taipei["id"]))
    assert backend.list_routes(trip["id"])[0]["arrival_area"]["id"] == tainan["id"]


def test_trip_overview_counts_records_and_flags_what_an_audience_would_miss_or_leak(backend: TravelMcpBackend) -> None:
    trip = backend.create_trip(schemas.TripCreate(title="Overview", starts_on="2054-11-16", ends_on="2054-12-10"))
    chiayi = backend.save_area(
        trip["id"], schemas.AreaInput(label="Chiayi City · concept", latitude=23.48, longitude=120.45)
    )
    dated = backend.create_visit(
        trip["id"], schemas.VisitCreate(area_id=chiayi["id"], title="Night market", starts_on="2054-12-02")
    )
    undated = backend.create_visit(trip["id"], schemas.VisitCreate(area_id=chiayi["id"], title="Old plan"))
    backend.create_stay(
        trip["id"], schemas.StayCreate(area_id=chiayi["id"], check_in_date="2054-12-02", check_out_date="2054-12-03")
    )
    tainan = backend.save_area(trip["id"], schemas.AreaInput(label="Tainan"))
    day_only = backend.create_route(
        trip["id"],
        schemas.RouteCreate(
            mode="train", departure_area_id=chiayi["id"], arrival_area_id=tainan["id"], departs_on="2054-12-05"
        ),
    )
    backend.create_route(
        trip["id"], schemas.RouteCreate(mode="train", departure_area_id=tainan["id"], arrival_area_id=chiayi["id"])
    )
    backend.set_visibility(trip["id"], "visit", dated["id"], "everyone", confirm=True)
    backend.set_public_projection_scope(trip["id"], schemas.ShareScopeInput(trip={"dates": "month"}), confirm=True)
    backend.publish_public_projection(trip["id"], confirm=True)
    link = backend.create_share_link(
        trip["id"], schemas.ShareLinkCreate(label="Family", scope={"trip": {"title": True}}), confirm=True
    )
    backend.update_visit(trip["id"], dated["id"], schemas.VisitUpdate())

    overview = backend.get_trip_overview(trip["id"])
    assert overview["counts"]["visits"] == 2 and overview["counts"]["visits_undated"] == 1
    assert overview["counts"]["routes"] == 2 and overview["counts"]["routes_undated"] == 1
    listed = backend.list_routes(trip["id"])
    assert [(row["id"], row["departs_on"], row["departs_at"]) for row in listed][0] == (
        day_only["id"],
        "2054-12-05",
        None,
    )
    assert overview["counts"]["stays"] == 1 and overview["counts"]["locations"] == 1
    assert overview["visibility"]["visit"] == {"everyone": 1, "private": 1}
    public, family = overview["audiences"]
    assert (public["kind"], public["state"], public["live"], public["dates_precision"]) == (
        "public",
        "published",
        True,
        "month",
    )
    assert public["delivered"]["visits"] == 1 and public["without_map_point"]["visits"] == 1
    assert (family["label"], family["state"], family["live"]) == ("Family", "draft", False)

    codes = {(warning["code"], warning["audience"], warning["severity"]) for warning in overview["warnings"]}
    assert ("trip_dates_shared", "public", "info") in codes
    assert ("planning_marker_visible", "public", "warning") in codes  # the area label rides along on the shared visit
    assert ("map_point_withheld", "public", "warning") in codes
    assert ("undated_visit_duplicates_dated", None, "info") in codes
    assert not any(code == "live_audience_receives_nothing" for code, _, _ in codes)
    assert next(w for w in overview["warnings"] if w["code"] == "undated_visit_duplicates_dated")["id"] == undated["id"]

    # An active link that selects nothing is flagged, not silently empty.
    backend.activate_share_link(trip["id"], link["id"], schemas.ShareLinkActivateRequest(), confirm=True)
    backend.set_visibility(trip["id"], "visit", dated["id"], "private", confirm=True)
    warnings = backend.get_trip_overview(trip["id"])["warnings"]
    empty = {warning["audience"] for warning in warnings if warning["code"] == "live_audience_receives_nothing"}
    assert empty == {"public", "Family"}
    assert not any(warning["code"] == "planning_marker_visible" for warning in warnings)


def test_duplicates_merge_and_unused_areas_and_locations_delete_over_mcp(backend: TravelMcpBackend) -> None:
    trip_id = backend.create_trip(schemas.TripCreate(title="Tidy"))["id"]
    keep = backend.save_location(trip_id, schemas.LocationInput(display_name="TPE Airport", locality="Taoyuan"))
    duplicate = backend.save_location(trip_id, schemas.LocationInput(display_name="Taoyuan airport"))
    backend.create_stay(
        trip_id,
        schemas.StayCreate(
            location=schemas.LocationInput(existing_location_id=duplicate["id"]),
            check_in_date="2054-04-01",
            check_out_date="2054-04-02",
        ),
    )
    unassigned = duplicate["area_id"]

    with pytest.raises(ValueError, match="confirm=true"):
        backend.delete_location(trip_id, duplicate["id"])
    with pytest.raises(ValueError, match="1 verblijf"):
        backend.delete_location(trip_id, duplicate["id"], confirm=True)
    with pytest.raises(ValueError, match="1 locatie"):
        backend.delete_area(trip_id, unassigned, confirm=True)

    preview = backend.merge_locations(trip_id, keep["id"], [duplicate["id"]])
    assert preview["applied"] is False and preview["duplicates"][0]["stays"] == 1
    assert len(backend.list_locations(trip_id)) == 2

    merged = backend.merge_locations(trip_id, keep["id"], [duplicate["id"]], confirm=True)
    assert merged["applied"] is True
    assert [location["id"] for location in backend.list_locations(trip_id)] == [keep["id"]]
    assert backend.list_stays(trip_id)[0]["location_id"] == keep["id"]
    with pytest.raises(ValueError, match="confirm=true"):
        backend.delete_area(trip_id, unassigned)
    assert backend.delete_area(trip_id, unassigned, confirm=True) == {"status": "deleted"}

    with TestingSessionLocal() as session:
        actions = [event.action for event in session.scalars(select(McpAuditEvent).order_by(McpAuditEvent.occurred_at))]
    assert "location.merge_preview" in actions and "location.merge" in actions and "area.delete" in actions
    assert MCP_TOOL_CAPABILITIES["merge_locations"] == {"effect": "write", "requires_confirmation": True}


def test_duplicate_areas_merge_over_mcp(backend: TravelMcpBackend) -> None:
    trip_id = backend.create_trip(schemas.TripCreate(title="Areas"))["id"]
    keep = backend.save_area(trip_id, schemas.AreaInput(label="Taipei"))
    duplicate = backend.save_area(trip_id, schemas.AreaInput(label="Taipei City"))
    backend.save_location(trip_id, schemas.LocationInput(display_name="Hotel", area_id=duplicate["id"]))

    preview = backend.merge_areas(trip_id, keep["id"], [duplicate["id"]])
    assert preview["applied"] is False and preview["duplicates"][0]["locations"] == 1
    assert len(backend.list_areas(trip_id)) == 2
    with pytest.raises(ValueError, match="keep_id"):
        backend.merge_areas(trip_id, keep["id"], [keep["id"]], confirm=True)

    assert backend.merge_areas(trip_id, keep["id"], [duplicate["id"]], confirm=True)["applied"] is True
    assert [area["id"] for area in backend.list_areas(trip_id)] == [keep["id"]]
    assert backend.list_locations(trip_id)[0]["area_id"] == keep["id"]
    assert MCP_TOOL_CAPABILITIES["merge_areas"] == {"effect": "write", "requires_confirmation": True}


def test_mcp_reads_and_writes_markdown_source_without_rendered_html(backend: TravelMcpBackend) -> None:
    trip = backend.create_trip(schemas.TripCreate(title="Exampleland 2054", summary="**Two** weeks"))
    assert trip["summary"] == "**Two** weeks"
    assert "summary_html" not in trip
    task = backend.create_trip_task(
        trip["id"], schemas.TripTaskCreate(title="Pack", notes="- [ ] socks\n- [ ] adapter")
    )
    assert "notes_html" not in task
    # A Markdown task list is display-only: it never creates trip tasks.
    assert [item["id"] for item in backend.list_trip_tasks(trip["id"])] == [task["id"]]
    assert all(not key.endswith("_html") for key in backend.get_trip(trip["id"]))
    assert schemas.TripTaskCreate.model_json_schema()["properties"]["notes"]["description"].startswith("Markdown")


def _audit_rows(*actions: str) -> list[tuple[str, str, str | None, str | None, str]]:
    query = select(McpAuditEvent).order_by(McpAuditEvent.action)
    if actions:
        query = query.where(McpAuditEvent.action.in_(actions))
    with TestingSessionLocal() as session:
        return [(e.action, e.resource_type, e.resource_id, e.trip_id, e.result) for e in session.scalars(query)]


def test_clients_list_only_the_entry_tools_and_the_search_and_call_proxies(backend: TravelMcpBackend) -> None:
    async def run() -> set[str]:
        async with _protocol_client() as client:
            return {tool.name for tool in await client.list_tools()}

    assert asyncio.run(run()) == {"whoami", "list_trips", "get_trip_overview", "search_tools", "call_tool"}


SEARCH_QUERIES = {
    "merge duplicate locations": {"merge_locations"},
    "locaties samenvoegen": {"merge_locations"},
    "delete area": {"delete_area"},
    "add a hotel stay": {"create_stay"},
    "verblijf toevoegen": {"create_stay"},
    "create several visits at once": {"batch_create"},
    "who can see this record": {"set_visibility"},
    "zichtbaarheid": {"set_visibility"},
    "preview what the share link shows": {"preview_share_link", "inspect_share_preview_file"},
    "publish the trip publicly": {"preview_public_projection", "publish_public_projection"},
    "import photos from google": {"start_media_import_session"},
    "reisupdate schrijven": {"create_travel_update"},
    "emergency numbers": {"list_emergency_info"},
    "noodnummers": {"list_emergency_info"},
    "tasks due this week": {"list_trip_tasks", "list_task_alerts"},
}


@pytest.mark.parametrize(("query", "expected"), SEARCH_QUERIES.items())
def test_search_finds_the_tool_for_a_task_in_english_and_dutch(
    backend: TravelMcpBackend, query: str, expected: set[str]
) -> None:
    async def run() -> list[str]:
        async with _protocol_client() as client:
            found = await client.call_tool("search_tools", {"query": query})
            return [tool["name"] for tool in found.structured_content["result"]]

    names = asyncio.run(run())
    assert len(names) <= 5
    assert expected <= set(names)


def test_every_hidden_tool_is_found_by_its_own_name(backend: TravelMcpBackend) -> None:
    async def run() -> dict[str, list[str]]:
        async with _protocol_client() as client:
            missed = {}
            for name in MCP_TOOL_CAPABILITIES:
                found = await client.call_tool("search_tools", {"query": name.replace("_", " ")})
                names = [tool["name"] for tool in found.structured_content["result"]]
                if name not in names and name not in {"whoami", "list_trips", "get_trip_overview"}:
                    missed[name] = names
            return missed

    assert asyncio.run(run()) == {}


def test_search_results_carry_the_callable_schema_and_capabilities(backend: TravelMcpBackend) -> None:
    server = create_mcp_server(TestingSessionLocal)
    registered = _registered_tools(server)

    async def run() -> list[dict[str, object]]:
        async with Client(server) as client:
            found = await client.call_tool("search_tools", {"query": "delete share link visit location"})
            return found.structured_content["result"]

    results = asyncio.run(run())
    assert results
    for result in results:
        name = result["name"]
        assert set(result) == {"name", "description", "input_schema", "effect", "requires_confirmation"}
        # The same self-contained schema a direct tools/list would send.
        assert result["input_schema"] == dereference_refs(registered[name].parameters)
        assert result["description"] == registered[name].description
        assert result["effect"] == MCP_TOOL_CAPABILITIES[name]["effect"]
        assert result["requires_confirmation"] == MCP_TOOL_CAPABILITIES[name]["requires_confirmation"]
    assert any(result["requires_confirmation"] for result in results)


def test_a_write_through_call_tool_is_audited_like_a_direct_call(backend: TravelMcpBackend) -> None:
    trip_id = backend.create_trip(schemas.TripCreate(title="Exampleland"))["id"]
    area = backend.save_area(trip_id, schemas.AreaInput(label="Taipei"))
    visit_id = backend.create_visit(trip_id, schemas.VisitCreate(area_id=area["id"]))["id"]
    arguments = {"trip_id": trip_id, "visit_id": visit_id, "payload": {"title": "Temple"}}

    async def run() -> None:
        async with _protocol_client() as client:
            await client.call_tool("update_visit", arguments)
            proxied = await client.call_tool("call_tool", {"name": "update_visit", "arguments": arguments})
            assert proxied.structured_content["title"] == "Temple"

    asyncio.run(run())
    direct, proxied = _audit_rows("visit.update")
    assert direct == proxied == ("visit.update", "visit", visit_id, trip_id, "succeeded")


def test_a_rejection_through_call_tool_is_audited_once_under_the_inner_tool(
    backend: TravelMcpBackend, caplog: pytest.LogCaptureFixture
) -> None:
    trip_id = backend.create_trip(schemas.TripCreate(title="Exampleland"))["id"]
    area = backend.save_area(trip_id, schemas.AreaInput(label="Taipei"))
    visit_id = backend.create_visit(trip_id, schemas.VisitCreate(area_id=area["id"]))["id"]

    async def run() -> tuple[object, object]:
        async with _protocol_client() as client:
            invalid = await client.call_tool(
                "call_tool",
                {
                    "name": "update_visit",
                    "arguments": {"trip_id": trip_id, "visit_id": visit_id, "payload": {"state": "SECRET-STATE"}},
                },
                raise_on_error=False,
            )
            unconfirmed = await client.call_tool(
                "call_tool",
                {"name": "delete_visit", "arguments": {"trip_id": trip_id, "visit_id": visit_id}},
                raise_on_error=False,
            )
            return invalid, unconfirmed

    with caplog.at_level(logging.INFO):
        invalid, unconfirmed = asyncio.run(run())

    assert invalid.is_error and "payload.state" in invalid.content[0].text
    assert unconfirmed.is_error and "confirm=true" in unconfirmed.content[0].text
    assert invalid.content[0].text.count("Reference:") == unconfirmed.content[0].text.count("Reference:") == 1
    assert _audit_rows("call_tool", "update_visit", "delete_visit", "visit.update", "visit.delete") == [
        ("update_visit", "tool_invocation", None, trip_id, "rejected"),
        ("visit.delete", "visit", visit_id, trip_id, "rejected"),
    ]
    with TestingSessionLocal() as session:
        details = [event.details for event in session.scalars(select(McpAuditEvent))]
    assert "SECRET-STATE" not in json.dumps(details) + caplog.text
    assert backend.get_visit(trip_id, visit_id)["id"] == visit_id


def test_call_tool_names_an_unknown_tool_clearly_and_logs_it(
    backend: TravelMcpBackend, caplog: pytest.LogCaptureFixture
) -> None:
    async def run() -> object:
        async with _protocol_client() as client:
            return await client.call_tool("call_tool", {"name": "drop_database", "arguments": {}}, raise_on_error=False)

    with caplog.at_level(logging.WARNING, logger="app.mcp_server"):
        result = asyncio.run(run())

    message = result.content[0].text
    assert result.is_error and "Unknown tool: 'drop_database'" in message and "search_tools" in message
    assert "call_tool named an unknown tool" in caplog.text and "drop_database" in caplog.text
    assert _audit_rows() == []


def test_a_full_owner_session_works_through_search_and_call_tool(backend: TravelMcpBackend) -> None:
    async def run() -> None:
        async with _protocol_client() as client:

            async def call(name: str, **arguments: object) -> object:
                found = await client.call_tool("search_tools", {"query": name.replace("_", " ")})
                assert name in [tool["name"] for tool in found.structured_content["result"]]
                return (await client.call_tool("call_tool", {"name": name, "arguments": arguments})).structured_content

            trip_id = (await call("create_trip", payload={"title": "Exampleland"}))["id"]
            trips = (await client.call_tool("list_trips", {})).structured_content["result"]
            assert [trip["id"] for trip in trips] == [trip_id]
            assert (await client.call_tool("get_trip_overview", {"trip_id": trip_id})).structured_content

            keep = await call("save_location", trip_id=trip_id, payload={"display_name": "TPE Airport"})
            duplicate = await call("save_location", trip_id=trip_id, payload={"display_name": "Taoyuan airport"})
            visit = await call(
                "create_visit", trip_id=trip_id, payload={"location": {"existing_location_id": duplicate["id"]}}
            )
            await call("update_visit", trip_id=trip_id, visit_id=visit["id"], payload={"title": "Arrival"})

            preview = await call(
                "merge_locations", trip_id=trip_id, keep_id=keep["id"], duplicate_ids=[duplicate["id"]]
            )
            assert preview["applied"] is False
            merged = await call(
                "merge_locations", trip_id=trip_id, keep_id=keep["id"], duplicate_ids=[duplicate["id"]], confirm=True
            )
            assert merged["applied"] is True
            assert (await call("get_visit", trip_id=trip_id, visit_id=visit["id"]))["location"]["id"] == keep["id"]

            link = await call("create_share_link", trip_id=trip_id, payload={"label": "Family"}, confirm=True)
            assert await call("preview_share_link", trip_id=trip_id, link_id=link["id"])

    asyncio.run(run())
    actions = [row[0] for row in _audit_rows()]
    assert {"location.merge_preview", "location.merge", "visit.update", "share_link.preview"} <= set(actions)


def test_update_location_geocodes_in_place_through_the_mcp_tool(backend: TravelMcpBackend) -> None:
    trip = backend.create_trip(schemas.TripCreate(title="Geocoding"))
    location = backend.save_location(trip["id"], schemas.LocationInput(label="Longshan", display_name="Longshan"))
    updated = backend.update_location(
        trip["id"],
        location["id"],
        schemas.LocationUpdate(
            latitude=25.0352844, longitude=121.4995813, osm_element_type="node", osm_element_id="3639530981"
        ),
    )
    assert updated["id"] == location["id"] and updated["latitude"] == 25.0352844
    assert updated["osm_url"] == "https://www.openstreetmap.org/node/3639530981"
    with pytest.raises(ValueError, match="latitude"):
        backend.update_location(trip["id"], location["id"], schemas.LocationUpdate(longitude=1.0))


# Delegated agent access (#338) ------------------------------------------

AGENT = "agent-1"
AGENT_SCOPES = ["openid", "travel:agent-read"]


@pytest.fixture
def delegation(mcp_resource: tuple[FastAPI, RSAKeyPair], monkeypatch: pytest.MonkeyPatch) -> tuple[FastAPI, RSAKeyPair]:
    monkeypatch.setattr(settings, "mcp_agent_actors", [AGENT])
    monkeypatch.setattr(settings, "mcp_agent_scope", "travel:agent-read")
    monkeypatch.setattr(settings, "mcp_agent_max_token_seconds", 900)
    with TestingSessionLocal() as session:
        trips_router.create_trip(schemas.TripCreate(title="Exampleland"), session, "owner-9")
    return mcp_resource


def _delegated(pair: RSAKeyPair, act: object = None, **claims: object) -> dict[str, str]:
    options = {
        "scopes": AGENT_SCOPES,
        "expires_in_seconds": 600,
        "additional_claims": {"act": {"sub": AGENT} if act is None else act},
    } | claims
    return _bearer(pair, **options)


def _rpc(client: TestClient, headers: dict[str, str], name: str, arguments: dict[str, object] | None = None) -> dict:
    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": arguments or {}}}
    response = client.post("/mcp/", json=body, headers=headers)
    assert response.status_code == 200, response.text
    data = (
        next(line[5:] for line in response.text.splitlines() if line.startswith("data:"))
        if "data:" in response.text
        else response.text
    )
    return json.loads(data)["result"]


def test_a_consented_delegated_token_reads_as_the_owner_and_is_audited_with_both(
    delegation: tuple[FastAPI, RSAKeyPair],
) -> None:
    application, pair = delegation
    with TestClient(application, base_url="https://travel.example.test") as client:
        who = _rpc(client, _delegated(pair), "whoami")
        trips = _rpc(client, _delegated(pair), "list_trips")
        owner_trips = _rpc(client, _bearer(pair), "list_trips")

    assert who["structuredContent"] == {"subject": "owner-9", "role": "delegated-agent", "actor": AGENT}
    assert [trip["title"] for trip in trips["structuredContent"]["result"]] == ["Exampleland"]
    assert owner_trips["structuredContent"] == trips["structuredContent"]
    with TestingSessionLocal() as session:
        rows = {
            (event.action, event.owner_subject, event.actor_subject, event.result)
            for event in session.scalars(select(McpAuditEvent))
        }
    assert ("trip.list", "owner-9", AGENT, "succeeded") in rows
    assert ("trip.list", "owner-9", None, "succeeded") in rows


@pytest.mark.parametrize(
    ("tool", "arguments"),
    [
        pytest.param("create_trip", {"payload": {"title": "Injected"}}, id="write"),
        pytest.param("delete_trip", {"trip_id": "x", "confirm": True}, id="deletion"),
        pytest.param("publish_public_projection", {"trip_id": "x", "confirm": True}, id="publication"),
        pytest.param("create_share_link", {"trip_id": "x", "confirm": True}, id="share-link"),
        pytest.param("list_mcp_audit_events", {}, id="audit-read"),
        pytest.param("list_documents", {"trip_id": "x"}, id="documents"),
        pytest.param("search_places", {"trip_id": "x", "payload": {"query": "Taipei"}}, id="external-service"),
    ],
)
def test_a_delegated_token_is_refused_every_tool_outside_the_read_allowlist(
    delegation: tuple[FastAPI, RSAKeyPair], tool: str, arguments: dict[str, object]
) -> None:
    application, pair = delegation
    with TestClient(application, base_url="https://travel.example.test") as client:
        direct = _rpc(client, _delegated(pair), tool, arguments)
        proxied = _rpc(client, _delegated(pair), "call_tool", {"name": tool, "arguments": arguments})

    for refused in (direct, proxied):
        assert refused["isError"] is True
        assert "not available to delegated agent access" in refused["content"][0]["text"]
    with TestingSessionLocal() as session:
        assert [trip.title for trip in session.scalars(select(Trip))] == ["Exampleland"]
        rows = list(session.scalars(select(McpAuditEvent).where(McpAuditEvent.action == tool)))
    # One row per attempt, each naming both parties and nothing from the payload.
    assert len(rows) == 2
    assert {(row.owner_subject, row.actor_subject, row.result) for row in rows} == {("owner-9", AGENT, "rejected")}
    assert "Injected" not in json.dumps([row.details for row in rows])


def test_a_delegated_token_reads_through_the_proxy_and_discovers_only_its_tools(
    delegation: tuple[FastAPI, RSAKeyPair],
) -> None:
    application, pair = delegation
    with TestClient(application, base_url="https://travel.example.test") as client:
        proxied = _rpc(client, _delegated(pair), "call_tool", {"name": "list_trips", "arguments": {}})
        found = _rpc(client, _delegated(pair), "search_tools", {"query": "delete trip publish share link"})
        owner_found = _rpc(client, _bearer(pair), "search_tools", {"query": "delete trip publish share link"})

    assert [trip["title"] for trip in proxied["structuredContent"]["result"]] == ["Exampleland"]
    assert {tool["name"] for tool in found["structuredContent"]["result"]} <= MCP_AGENT_READ_TOOLS
    assert {"delete_trip", "publish_public_projection"} & {
        tool["name"] for tool in owner_found["structuredContent"]["result"]
    }


@pytest.mark.parametrize(
    "claims",
    [
        pytest.param({"act": {"sub": "agent-2"}}, id="actor-not-allowed"),
        pytest.param({"act": "agent-1"}, id="act-is-not-an-object"),
        pytest.param({"act": {}}, id="act-without-subject"),
        pytest.param({"act": {"sub": ""}}, id="act-with-empty-subject"),
        pytest.param({"act": {"sub": AGENT, "act": {"sub": "agent-3"}}}, id="nested-actor-chain"),
        pytest.param({"act": {"sub": "owner-9"}}, id="actor-is-the-owner"),
        pytest.param({"scopes": ["openid"]}, id="missing-delegated-scope"),
        pytest.param({"expires_in_seconds": 3600}, id="lifetime-too-long"),
        pytest.param({"expires_in_seconds": -60}, id="expired"),
        pytest.param({"audience": "travel-api"}, id="wrong-audience"),
    ],
)
def test_a_delegated_token_that_breaks_the_policy_is_unauthorized_and_unaudited(
    delegation: tuple[FastAPI, RSAKeyPair], claims: dict[str, object]
) -> None:
    application, pair = delegation
    act = claims.pop("act", None)
    with TestClient(application, base_url="https://travel.example.test") as client:
        refused = client.post("/mcp/", json=WHOAMI_CALL, headers=_delegated(pair, act, **claims))

    assert refused.status_code == 401
    with TestingSessionLocal() as session:
        assert list(session.scalars(select(McpAuditEvent))) == []


def test_delegation_is_off_until_an_actor_is_allowed(
    delegation: tuple[FastAPI, RSAKeyPair], monkeypatch: pytest.MonkeyPatch
) -> None:
    application, pair = delegation
    monkeypatch.setattr(settings, "mcp_agent_actors", [])
    with TestClient(application, base_url="https://travel.example.test") as client:
        assert client.post("/mcp/", json=WHOAMI_CALL, headers=_delegated(pair)).status_code == 401
        assert client.post("/mcp/", json=WHOAMI_CALL, headers=_bearer(pair)).status_code == 200


def test_delegation_refusal_explains_without_echoing_claims(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "mcp_agent_actors", [AGENT])
    monkeypatch.setattr(settings, "mcp_agent_scope", "travel:agent-read")
    monkeypatch.setattr(settings, "mcp_agent_max_token_seconds", 900)
    base = {"sub": "owner-9", "act": {"sub": AGENT}, "iat": 1000, "exp": 1600}
    assert delegation_refusal({"sub": "owner-9"}, []) is None
    assert delegation_refusal(base, ["travel:agent-read"]) is None
    assert delegation_refusal(base, []) == "missing delegated scope"
    assert delegation_refusal({**base, "exp": 1901}, ["travel:agent-read"]) == "lifetime too long"
    assert delegation_refusal({**base, "iat": None}, ["travel:agent-read"]) == "missing iat or exp"
    assert delegation_refusal({**base, "act": {"sub": "agent-2"}}, ["travel:agent-read"]) == "actor not allowed"


def test_the_agent_allowlist_holds_only_existing_read_only_tools() -> None:
    assert set(MCP_TOOL_CAPABILITIES) >= MCP_AGENT_READ_TOOLS
    assert {MCP_TOOL_CAPABILITIES[name]["effect"] for name in MCP_AGENT_READ_TOOLS} == {"read"}
    assert not any(MCP_TOOL_CAPABILITIES[name]["requires_confirmation"] for name in MCP_AGENT_READ_TOOLS)
    assert {"search_tools", "call_tool"} == MCP_DELEGATED_TOOLS - MCP_AGENT_READ_TOOLS
