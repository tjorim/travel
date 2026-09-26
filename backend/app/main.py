from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, status
from fastmcp.utilities.lifespan import combine_lifespans
from sqlalchemy import text

from .database import SessionLocal
from .mcp_server import MCP_CAPABILITY_CONTRACT_VERSION, MCP_TOOL_CAPABILITIES, create_mcp_http_app, mcp_http_enabled
from .routers.areas import router as areas_router
from .routers.documents import router as documents_router
from .routers.library import router as library_router
from .routers.locations import router as locations_router
from .routers.markdown import router as markdown_router
from .routers.media import provider_tokens_router
from .routers.media import router as media_router
from .routers.places import router as places_router
from .routers.publication import delivery_router as publication_delivery_router
from .routers.publication import router as publication_router
from .routers.routes import router as routes_router
from .routers.stays import router as stays_router
from .routers.tasks import router as tasks_router
from .routers.trips import router as trips_router
from .routers.visibility import router as visibility_router
from .routers.visits import router as visits_router

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
    title="Travel tracker API",
    description="Private-by-default trip and reisupdate tracking API.",
    version="0.1.0",
    lifespan=_lifespan,
)
app.include_router(trips_router, prefix="/api")
app.include_router(visibility_router, prefix="/api")
app.include_router(visits_router, prefix="/api")
app.include_router(publication_router, prefix="/api")
app.include_router(publication_delivery_router, prefix="/api")
app.include_router(stays_router, prefix="/api")
app.include_router(routes_router, prefix="/api")
app.include_router(tasks_router, prefix="/api")
app.include_router(documents_router, prefix="/api")
app.include_router(library_router, prefix="/api")
app.include_router(media_router, prefix="/api")
app.include_router(places_router, prefix="/api")
app.include_router(areas_router, prefix="/api")
app.include_router(locations_router, prefix="/api")
app.include_router(markdown_router, prefix="/api")
app.include_router(provider_tokens_router, prefix="/api")

if _mcp_app is not None:
    app.mount("/mcp", _mcp_app)


@app.get("/api/mcp/capabilities", tags=["mcp"])
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
        "resources": [],
        "prompts": [],
    }


@app.get("/api/health", tags=["health"])
def health() -> dict[str, str]:
    try:
        with SessionLocal() as session:
            session.execute(text("SELECT 1"))
    except Exception as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database unavailable") from error
    return {"status": "ok"}
