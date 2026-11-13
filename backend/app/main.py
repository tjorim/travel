from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, status
from fastapi.exceptions import RequestValidationError
from fastmcp.utilities.lifespan import combine_lifespans
from sqlalchemy import text
from starlette.exceptions import HTTPException as StarletteHTTPException

from .auth import current_subject
from .database import SessionLocal
from .errors import ApiException, Refusal, http_error_handler, service_error_handler, validation_error_handler
from .mcp_server import (
    MCP_CAPABILITY_CONTRACT_VERSION,
    MCP_TOOL_CAPABILITIES,
    MCP_VISIBLE_TOOLS,
    create_mcp_http_app,
    mcp_http_enabled,
    mount_mcp,
)
from .request_limits import RateLimitExceeded, RateLimitHeadersMiddleware
from .request_timing import RequestTimingMiddleware
from .routers.alternatives import router as alternatives_router
from .routers.areas import router as areas_router
from .routers.auth import router as auth_router
from .routers.collections import delivery_router as collection_delivery_router
from .routers.collections import membership_router as collection_membership_router
from .routers.collections import router as collections_router
from .routers.documents import router as documents_router
from .routers.library import router as library_router
from .routers.link_preview import router as link_preview_router
from .routers.live_location import router as live_location_router
from .routers.locations import router as locations_router
from .routers.markdown import router as markdown_router
from .routers.media import provider_tokens_router
from .routers.media import router as media_router
from .routers.packing import router as packing_router
from .routers.packing import sources_router as packing_sources_router
from .routers.packing import templates_router as packing_templates_router
from .routers.places import router as places_router
from .routers.precision import router as precision_router
from .routers.publication import delivery_rate_limit_handler
from .routers.publication import delivery_router as publication_delivery_router
from .routers.publication import router as publication_router
from .routers.routes import router as routes_router
from .routers.sharing_presets import router as sharing_presets_router
from .routers.stays import router as stays_router
from .routers.tasks import router as tasks_router
from .routers.translation import router as translation_router
from .routers.trips import router as trips_router
from .routers.visibility import router as visibility_router
from .routers.visits import router as visits_router
from .schemas import HealthResponse, McpCapabilitiesResponse, OwnerIdentityResponse
from .version import APP_COMMIT, APP_VERSION

if mcp_http_enabled():
    _mcp, _mcp_app = create_mcp_http_app()
else:
    _mcp = None
    _mcp_app = None


@asynccontextmanager
async def _application_lifespan(_: FastAPI) -> AsyncGenerator[None]:
    yield


_lifespan = (
    combine_lifespans(_application_lifespan, _mcp_app.lifespan) if _mcp_app is not None else _application_lifespan
)

app = FastAPI(
    title="Travel API",
    description="Private-by-default API for trips, reisupdates and what visitors may read of them.",
    version="2026.11.2",
    lifespan=_lifespan,
)
app.add_middleware(RateLimitHeadersMiddleware)
# Starlette types handlers against `Exception`, not the specific class they are registered for.
app.add_exception_handler(StarletteHTTPException, http_error_handler)  # ty: ignore[invalid-argument-type]
app.add_exception_handler(Refusal, service_error_handler)  # ty: ignore[invalid-argument-type]
app.add_exception_handler(RequestValidationError, validation_error_handler)  # ty: ignore[invalid-argument-type]
app.add_exception_handler(RateLimitExceeded, delivery_rate_limit_handler)  # ty: ignore[invalid-argument-type]
# Outermost, so its timing covers everything below it (apps#246).
app.add_middleware(RequestTimingMiddleware)

app.include_router(live_location_router, prefix="/api")
app.include_router(auth_router, prefix="/api")
app.include_router(trips_router, prefix="/api")
app.include_router(visibility_router, prefix="/api")
app.include_router(visits_router, prefix="/api")
app.include_router(precision_router, prefix="/api")
app.include_router(publication_router, prefix="/api")
app.include_router(collections_router, prefix="/api")
app.include_router(collection_membership_router, prefix="/api")
app.include_router(sharing_presets_router, prefix="/api")
app.include_router(publication_delivery_router, prefix="/api")
app.include_router(collection_delivery_router, prefix="/api")
app.include_router(link_preview_router, prefix="/api")
app.include_router(stays_router, prefix="/api")
app.include_router(alternatives_router, prefix="/api")
app.include_router(routes_router, prefix="/api")
app.include_router(tasks_router, prefix="/api")
app.include_router(packing_router, prefix="/api")
app.include_router(packing_templates_router, prefix="/api")
app.include_router(packing_sources_router, prefix="/api")
app.include_router(documents_router, prefix="/api")
app.include_router(library_router, prefix="/api")
app.include_router(media_router, prefix="/api")
app.include_router(places_router, prefix="/api")
app.include_router(areas_router, prefix="/api")
app.include_router(locations_router, prefix="/api")
app.include_router(markdown_router, prefix="/api")
app.include_router(translation_router, prefix="/api")
app.include_router(provider_tokens_router, prefix="/api")

if _mcp is not None and _mcp_app is not None:
    mount_mcp(app, _mcp, _mcp_app)


@app.get("/api/mcp/capabilities", tags=["mcp"], response_model=McpCapabilitiesResponse)
def mcp_capabilities() -> dict[str, object]:
    """Describe the MCP surface actually mounted in this process.

    Kept outside the owner API routes so deployment diagnostics can establish
    whether an authenticated MCP listener is enabled without exposing owner
    data or a tool invocation path.
    """
    return {
        "contract_version": MCP_CAPABILITY_CONTRACT_VERSION,
        "enabled": _mcp_app is not None,
        "mount_path": "/mcp",
        "version": _mcp.version if _mcp is not None else None,
        "tools": [
            {"name": name, **capability, "access": {}} for name, capability in sorted(MCP_TOOL_CAPABILITIES.items())
        ]
        if _mcp_app is not None
        else [],
        # The tools a client lists; every other tool is found with search_tools
        # and run through call_tool (#196).
        "visible_tools": list(MCP_VISIBLE_TOOLS) if _mcp_app is not None else [],
        "resources": [],
        "prompts": [],
    }


@app.get("/api/health", tags=["health"], response_model=HealthResponse)
def health() -> dict[str, str]:
    try:
        with SessionLocal() as session:
            session.execute(text("SELECT 1"))
    except Exception as error:
        raise ApiException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database unavailable", code="database_unavailable"
        ) from error
    return {"status": "ok", "version": APP_VERSION, "commit": APP_COMMIT}


@app.get("/api/identity", tags=["owner"], response_model=OwnerIdentityResponse)
def owner_identity(subject: Annotated[str, Depends(current_subject)]) -> dict[str, object]:
    """Authenticated ordinary API identity, never part of visitor projections."""
    return {
        "subject": subject,
        "contract_version": 1,
        "capabilities": ["trip-tasks:read-write", "packing:read-write", "live-location:write"],
    }
