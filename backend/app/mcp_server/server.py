"""The MCP server: tool registration, failure reporting, the capability manifest, OIDC and the HTTP app."""

from __future__ import annotations

import base64
import binascii
import json
import time
from collections.abc import Callable, Sequence
from typing import Any, Literal

import anyio.to_thread
from fastapi import FastAPI, Request
from fastmcp import FastMCP
from fastmcp.exceptions import DisabledError, FastMCPError, NotFoundError, ToolError
from fastmcp.exceptions import ValidationError as ArgumentValidationError
from fastmcp.server.auth.providers.jwt import JWTVerifier
from fastmcp.server.auth.providers.keycloak import KeycloakAuthProvider
from fastmcp.server.http import StarletteWithLifespan
from fastmcp.server.middleware import Middleware, MiddlewareContext
from fastmcp.server.transforms.search import BM25SearchTransform
from fastmcp.tools.base import Tool
from mcp.types import ToolAnnotations
from pydantic import AnyHttpUrl, ValidationError
from sqlalchemy.orm import Session, sessionmaker
from starlette.middleware import Middleware as StarletteMiddleware
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from ..authlimit import THROTTLED_DETAIL, failed_authentication, throttled_headers
from ..config import settings
from ..database import SessionLocal
from .backend import TOOL_FAMILIES, TravelMcpBackend
from .core import _AUDITED, _REPORTED, ResponseValidationError, _reported, _request_id, _validation_fields, logger

# Clients list only these tools plus the two below; every other tool is found
# with ``search_tools`` and run through ``call_tool`` (layered discovery, #196).
# Nearly every session starts by finding a trip and reading its overview.
MCP_ALWAYS_VISIBLE_TOOLS = ("whoami", "list_trips", "get_trip_overview")
MCP_SEARCH_TOOL = "search_tools"
MCP_CALL_TOOL = "call_tool"
MCP_VISIBLE_TOOLS = (*MCP_ALWAYS_VISIBLE_TOOLS, MCP_SEARCH_TOOL, MCP_CALL_TOOL)
# Each result carries the tool's full input schema and Travel's are large
# (``batch_create`` alone is ~16k characters), so a search returns fewer
# results than the siblings' 10.
MCP_SEARCH_MAX_RESULTS = 5


class ToolFailureMiddleware(Middleware):
    """Turn every failure that would surface as a bare protocol error into a correlated tool error.

    FastMCP reports a pydantic error raised by a tool body as ``-32602 Invalid
    request parameters`` and any other unexpected failure as a generic
    ``-32603``; neither names the tool or can be found in the server logs.
    This maps them to an ``isError`` result carrying the MCP request id, logs
    the same id, and audits calls that were refused before ``_call`` ran (for
    example invalid arguments). Only names, types and field paths are logged.

    A tool reached through ``call_tool`` passes through this middleware twice:
    once as itself, where it is audited and reported under its own name, and
    once as the ``call_tool`` proxy, which hands that report on unchanged.
    """

    def __init__(self, backend: TravelMcpBackend) -> None:
        self.backend = backend

    async def on_call_tool(self, context: MiddlewareContext[Any], call_next: Callable[..., Any]) -> Any:
        try:
            return await call_next(context)
        except NotFoundError, DisabledError:
            raise
        except Exception as error:
            if getattr(error, _REPORTED, False):
                raise
            tool = context.message.name
            request_id = _request_id()
            if tool == MCP_CALL_TOOL and isinstance(error.__cause__, NotFoundError):
                # Like an unknown tool called directly, this is not audited.
                requested = (context.message.arguments or {}).get("name")
                logger.warning("MCP call_tool named an unknown tool request_id=%s tool=%.80r", request_id, requested)
                raise _reported(
                    ToolError(
                        f"Unknown tool: {requested!r}. Use {MCP_SEARCH_TOOL} to find the tool for a task. "
                        f"Reference: {request_id}"
                    )
                ) from None
            audited = getattr(error, _AUDITED, False) or getattr(error.__cause__, _AUDITED, False)
            if not audited:
                await anyio.to_thread.run_sync(
                    self.backend._audit_unexecuted_rejection, tool, context.message.arguments, error
                )
            if isinstance(error, (ValidationError, ResponseValidationError)):
                fields = error.fields if isinstance(error, ResponseValidationError) else _validation_fields(error)
                logger.warning("MCP tool %s failed validation request_id=%s fields=%s", tool, request_id, fields)
                raise _reported(
                    ToolError(
                        f"{tool} failed validation ({fields}); the stored or generated data did not match the API "
                        f"schema. Reference: {request_id}"
                    )
                ) from None
            if isinstance(error, ArgumentValidationError) and isinstance(error.__cause__, ValidationError):
                # FastMCP wraps a bad call's pydantic error and its message echoes the rejected values.
                fields = _validation_fields(error.__cause__)
                logger.warning("MCP tool %s rejected its arguments request_id=%s fields=%s", tool, request_id, fields)
                raise _reported(
                    ToolError(f"{tool} rejected its arguments ({fields}). Reference: {request_id}")
                ) from None
            if isinstance(error, FastMCPError):
                raise _reported(ToolError(f"{error} Reference: {request_id}")) from error
            logger.error("MCP tool %s failed request_id=%s error=%s", tool, request_id, type(error).__name__)
            raise _reported(
                ToolError(f"{tool} hit an unexpected {type(error).__name__}. Reference: {request_id}")
            ) from None


# Every public method of a tool family is a tool, registered in the order of the families.
_TOOL_NAMES = tuple(
    name
    for family in TOOL_FAMILIES
    for name, value in vars(family).items()
    if not name.startswith("_") and callable(value)
)

# Version of the cross-app capability manifest contract shared by the Travel,
# Worktime, Champagnefestival and Daynest `/api/mcp/capabilities` endpoints
# (tjorim/apps#229). Each tool reports `effect`, `requires_confirmation` and an
# app-specific `access` object; Travel has one owner-only policy, so `access` is
# empty rather than an invented per-tool tier.
MCP_CAPABILITY_CONTRACT_VERSION = 1

# One authoritative manifest serves registration and FastAPI discovery, so an
# operator can inspect exactly the tools mounted at /mcp without maintaining a
# second hand-written list. `effect` is intentionally a small safety signal,
# not an authorization mechanism.
MCP_TOOL_CAPABILITIES: dict[str, dict[str, Literal["read", "write"] | bool]] = {
    name: {
        "effect": "read"
        if name.startswith(("get_", "list_", "search_", "reverse_", "preview_", "inspect_", "suggest_", "whoami"))
        else "write",
        "requires_confirmation": name.startswith(("delete_", "revoke_", "unpublish_", "publish_", "set_"))
        or name
        in {
            "create_share_link",
            "update_share_link",
            "activate_share_link",
            "rotate_share_link",
            "create_collection",
            "update_collection",
            "add_collection_member",
            "update_collection_member",
            "remove_collection_member",
            "activate_collection",
            "rotate_collection",
            "approve_media_derivative",
            "complete_media_import_session",
            "merge_locations",
            "merge_areas",
            "follow_audience_date_precision",
            "apply_sharing_preset",
            "choose_alternative",
            "undo_alternative_choice",
        },
    }
    for name in _TOOL_NAMES
}


# Write tools that only add data or advance a state (draft -> active, pending ->
# approved); none replaces data that already exists.  MCP's ``destructiveHint``
# means "may delete or overwrite", so anything absent from this set (every
# ``update_*``, ``delete_*``, ``revoke_*``/``unpublish_*``,
# ``set_public_projection_scope`` and ``rotate_share_link``, which revokes the
# current capability, plus any future unclassified tool) is destructive.
_ADDITIVE_WRITE_TOOLS = frozenset(
    {name for name in _TOOL_NAMES if name.startswith("create_")}
    | {
        "batch_create",
        "save_location",
        "save_area",
        "upload_media",
        "upload_document",
        "upload_library_document",
        "approve_media_derivative",
        "activate_share_link",
        "activate_collection",
        "add_collection_member",
        "publish_public_projection",
        "start_media_import_session",
        "complete_media_import_session",
        "mark_task_alert_read",
    }
)

# Tools that call an external service (the place-search provider, media import
# providers), so their effect is not confined to Travel's own data.
_OPEN_WORLD_TOOLS = frozenset(
    {
        "search_places",
        "reverse_geocode_place",
        "suggest_area",
        "start_media_import_session",
        "complete_media_import_session",
    }
)


def _tool_annotations(name: str) -> ToolAnnotations:
    capability = MCP_TOOL_CAPABILITIES[name]
    read = capability["effect"] == "read"
    return ToolAnnotations(
        read_only_hint=read,
        destructive_hint=False if read else name not in _ADDITIVE_WRITE_TOOLS,
        idempotent_hint=read,
        open_world_hint=name in _OPEN_WORLD_TOOLS,
    )


def _search_result(tools: Sequence[Tool]) -> list[dict[str, Any]]:
    """Each found tool with its callable schema and its capability-manifest entry."""
    return [
        {
            "name": tool.name,
            "description": tool.description,
            "input_schema": tool.parameters,
            **MCP_TOOL_CAPABILITIES.get(tool.name, {}),
        }
        for tool in tools
    ]


MCP_INSTRUCTIONS = (
    "Private Travel owner-management tools. Start with list_trips and get_trip_overview; find every other tool by "
    f"task with {MCP_SEARCH_TOOL} (for example 'merge duplicate locations' or 'share link preview') and run it with "
    f"{MCP_CALL_TOOL}. Each search result says whether the tool reads or writes and whether it requires "
    "confirmation: tools that change who can see something, publish, or delete data need confirm=true, so review "
    "their preview or target first. Long-form text (trip summary, visit summary and notes, reisupdate body and "
    "private notes, stay, route, task, location and emergency-information notes) is Markdown, including tables; "
    "task lists in it are display-only and never create trip tasks. A media caption is inline Markdown only (bold, "
    "italic, links), and a stay's contact_details is plain text whose phone numbers, email and web addresses become "
    "links. Give hotels and transport that are only being compared the status idea: ideas may overlap, cover no "
    "night or journey and are never shared; use planned for the intended stay or route. Group ideas that compete for "
    "the same nights, days or journey with create_alternative_group (suggest_alternative_groups proposes them) and "
    "settle a group with choose_alternative, which plans the chosen one and cancels or removes the rest."
)


class OutageAwareJWTVerifier(JWTVerifier):
    """FastMCP's verifier, which reports signing keys it could not fetch.

    ``verify_token`` returns None both for a refused token and for an unreachable JWKS endpoint, so the failed
    attempt limit (#46) could not tell them apart. This notes a failed fetch, and the refresh cool-down that
    follows it, so those requests are not counted against the client. ``outage_events`` only ever grows; a request
    was affected when it changed while the request ran.
    """

    _last_fetch_failed = False
    outage_events = 0

    async def _fetch_jwks(self) -> dict[str, Any]:
        try:
            keys = await super()._fetch_jwks()
        except Exception:
            self._last_fetch_failed = True
            self._note_outage()
            raise
        self._last_fetch_failed = False
        return keys

    async def _get_jwks_key(self, kid: str | None) -> str:
        try:
            return await super()._get_jwks_key(kid)
        except ValueError:
            if self._last_fetch_failed:
                self._note_outage()
            raise

    def _note_outage(self) -> None:
        self.outage_events += 1


class TravelMcpAuthProvider(KeycloakAuthProvider):
    """Keycloak resource-server auth bound to Travel's canonical MCP URL.

    Clients discover Keycloak directly (RFC 9728) and receive Keycloak tokens,
    so this server only verifies: issuer, signature, expiry, the ``openid``
    scope and the dedicated MCP audience.  It is never an OAuth proxy.  The
    default provider appends the in-app mount path to the base URL, which
    would advertise ``.../mcp/``; the resource identifier a client sends as
    its RFC 8707 ``resource`` must be exactly the configured URL.
    """

    def _get_resource_url(self, path: str | None = None) -> AnyHttpUrl | None:
        return self.base_url


def create_mcp_server(factory: sessionmaker[Session] = SessionLocal) -> FastMCP:
    """Create Travel's MCP server with OIDC verification when configured."""
    auth = None
    if settings.oidc_issuer_url and settings.mcp_resource_url:
        realm_url = settings.oidc_issuer_url.rstrip("/")
        auth = TravelMcpAuthProvider(
            realm_url=realm_url,
            base_url=settings.mcp_resource_url,
            audience=settings.mcp_token_audience,
            token_verifier=OutageAwareJWTVerifier(
                jwks_uri=f"{realm_url}/protocol/openid-connect/certs",
                issuer=realm_url,
                algorithm="RS256",
                required_scopes=["openid"],
                audience=settings.mcp_token_audience,
            ),
        )
    server = FastMCP(
        "travel",
        version="2026.11.2",
        instructions=MCP_INSTRUCTIONS,
        auth=auth,
        transforms=[
            BM25SearchTransform(
                max_results=MCP_SEARCH_MAX_RESULTS,
                always_visible=list(MCP_ALWAYS_VISIBLE_TOOLS),
                search_tool_name=MCP_SEARCH_TOOL,
                call_tool_name=MCP_CALL_TOOL,
                search_result_serializer=_search_result,
            )
        ],
    )
    backend = TravelMcpBackend(factory)
    server.add_middleware(ToolFailureMiddleware(backend))
    for name in MCP_TOOL_CAPABILITIES:
        server.tool(name=name, annotations=_tool_annotations(name))(getattr(backend, name))
    return server


def mcp_http_enabled() -> bool:
    """Whether this process has enough deployment configuration to mount MCP.

    Never mount an unauthenticated HTTP MCP endpoint. Local stdio remains
    development-only and is started explicitly through ``main()`` below.
    """
    return bool(settings.mcp_base_url and settings.oidc_issuer_url)


def _jwt_segment(segment: str) -> dict[str, Any]:
    decoded = json.loads(base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4)))
    if not isinstance(decoded, dict):
        raise ValueError("JWT segment is not an object")
    return decoded


def _unauthorized_reason(authorization: str | None) -> str:
    """Why a bearer header might have been refused, from unverified claims and never the token itself."""
    if not authorization:
        return "no Authorization header"
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return "Authorization header is not a Bearer token"
    parts = token.strip().split(".")
    if len(parts) != 3:
        return f"bearer token is not a JWT ({len(parts)} segments)"
    try:
        header, claims = _jwt_segment(parts[0]), _jwt_segment(parts[1])
    except ValueError, binascii.Error:
        return "bearer token has an undecodable JWT header or payload"
    exp = claims.get("exp")
    expiry = f"{int(exp - time.time())}s" if isinstance(exp, int | float) else None
    return (
        f"kid={header.get('kid')!r} alg={header.get('alg')!r} iss={claims.get('iss')!r} "
        f"aud={claims.get('aud')!r} azp={claims.get('azp')!r} expires_in={expiry}"
    )


class UnauthorizedRequestLogger:
    """Log every 401 from the MCP app with a token-free reason.

    The MCP SDK refuses a missing header silently and FastMCP logs most
    verification failures only at DEBUG, so a client's intermittent 401 left
    no trace beyond the access log (#184).
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_logging_401(message: Message) -> None:
            if message["type"] == "http.response.start" and message["status"] == 401:
                headers = {key.lower(): value for key, value in scope["headers"]}
                authorization = headers.get(b"authorization")
                logger.warning(
                    "MCP %s %s rejected with 401: %s",
                    scope["method"],
                    scope["path"],
                    _unauthorized_reason(authorization.decode("latin-1") if authorization else None),
                )
            await send(message)

        await self.app(scope, receive, send_logging_401)


def _bearer_token_present(headers: Sequence[tuple[bytes, bytes]]) -> bool:
    for key, value in headers:
        if key.lower() == b"authorization":
            scheme, _, token = value.decode("latin-1").partition(" ")
            return scheme.lower() == "bearer" and bool(token.strip())
    return False


class AuthenticationFailureLimiter:
    """Refuse a client with too many failed bearer tokens with 429, and count a 401 that refused a token (#46).

    A request without a bearer token is neither refused nor counted (it costs no verification, and a client's first
    request legitimately has none), and neither is a 401 caused by an identity-provider outage.
    """

    def __init__(self, app: ASGIApp, verifier: OutageAwareJWTVerifier | None = None) -> None:
        self.app = app
        self.verifier = verifier

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not _bearer_token_present(scope["headers"]):
            await self.app(scope, receive, send)
            return
        request = Request(scope)
        retry_after = failed_authentication.retry_after(request)
        if retry_after is not None:
            response = JSONResponse(
                {"detail": THROTTLED_DETAIL, "errors": [{"code": "rate_limited", "params": {}, "path": []}]},
                status_code=429,
                headers=throttled_headers(retry_after),
            )
            await response(scope, receive, send)
            return

        outages_before = self.verifier.outage_events if self.verifier is not None else 0

        async def send_counting_401(message: Message) -> None:
            if message["type"] == "http.response.start" and message["status"] == 401:
                outage = self.verifier is not None and self.verifier.outage_events != outages_before
                if not outage:
                    failed_authentication.record_failure(request)
            await send(message)

        await self.app(scope, receive, send_counting_401)


# The ceiling the MCP SDK's streamable HTTP transport applies to a request body (``DEFAULT_MAX_REQUEST_BODY_SIZE``;
# FastMCP offers no way to change it). It bounds the encoded JSON of every tool call, so a base64 upload over HTTP is
# limited to about three quarters of it. A larger file goes through the multipart upload API (#84).
MCP_MAX_REQUEST_BODY_BYTES = 4 * 1024 * 1024
MCP_REQUEST_TOO_LARGE_DETAIL = (
    "MCP request bodies are limited to 4 MiB, so a base64 upload over MCP holds about 3 MiB. "
    "Upload larger files through the multipart upload API."
)


class RequestBodyCap:
    """Refuse a request that declares a body above the MCP ceiling before anything reads it.

    The SDK enforces the same ceiling as it reads, and answers a bare ``413``. A declared length is known up front,
    so this refuses it with a message that names the limit and the alternative, without receiving a single chunk.
    """

    def __init__(self, app: ASGIApp, limit: int = MCP_MAX_REQUEST_BODY_BYTES) -> None:
        self.app = app
        self.limit = limit

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            declared = next((value for key, value in scope["headers"] if key.lower() == b"content-length"), b"")
            if declared.isdigit() and int(declared) > self.limit:
                response = JSONResponse(
                    {
                        "detail": MCP_REQUEST_TOO_LARGE_DETAIL,
                        "errors": [{"code": "mcp_request_too_large", "params": {"limit": self.limit}, "path": []}],
                    },
                    status_code=413,
                )
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)


def create_mcp_http_app(
    factory: sessionmaker[Session] = SessionLocal, **http_app_kwargs: Any
) -> tuple[FastMCP, StarletteWithLifespan]:
    """Create the authenticated, stateless HTTP app mounted by FastAPI.

    Keeping this factory beside ``create_mcp_server`` mirrors Worktime's
    pattern and prevents application startup from accidentally mounting an
    unauthenticated FastMCP instance.
    """
    if not mcp_http_enabled():
        raise RuntimeError("MCP HTTP requires TRAVEL_MCP_BASE_URL and TRAVEL_OIDC_ISSUER_URL")
    server = create_mcp_server(factory)
    middleware = [StarletteMiddleware(UnauthorizedRequestLogger), *(http_app_kwargs.pop("middleware", None) or [])]
    mcp_app = server.http_app(path="/", stateless_http=True, middleware=middleware, **http_app_kwargs)
    # FastMCP runs its own authentication ahead of every middleware passed above, so the failed-attempt limit must be
    # added to the app to sit outside it and refuse a throttled client before its token is verified (#46).
    mcp_app.add_middleware(AuthenticationFailureLimiter, verifier=getattr(server.auth, "token_verifier", None))
    # Outermost: an oversized declared body is refused before the throttle, the token check or any read.
    mcp_app.add_middleware(RequestBodyCap)
    return server, mcp_app


def mount_mcp(app: FastAPI, server: FastMCP, mcp_app: StarletteWithLifespan) -> None:
    """Mount the MCP app and publish its RFC 9728 metadata at the host root.

    The metadata lives at ``/.well-known/oauth-protected-resource/<path>``, which a
    mount at ``/mcp`` would otherwise hide at ``/mcp/.well-known/...``, so the
    challenge's ``resource_metadata`` URL would lead nowhere.
    """
    if server.auth is not None:
        app.router.routes.extend(server.auth.get_well_known_routes("/"))
    app.mount("/mcp", mcp_app)


def main() -> None:
    """Run the authenticated local stdio MCP server."""
    create_mcp_server().run()


if __name__ == "__main__":
    main()
