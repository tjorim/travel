"""Authenticated, typed owner MCP tools for Travel.

The MCP layer is deliberately a thin adapter over the owner services in ``app/services``, which the browser API's
routers share. Each tool opens a session, supplies the authenticated subject, runs one service call (or one batch)
in one transaction that the tool commits, and validates with the same Pydantic request/response models as the
browser API. It never accepts SQL, filesystem paths, object keys, URLs to fetch, or arbitrary HTTP instructions.

Tools live in one module per family (trips, itinerary, places, sharing, collections, media, documents, packing,
tasks, alternatives); ``backend.TravelMcpBackend`` combines them and ``server`` registers them.

Production transport wiring belongs to apps#226.  This package intentionally
supports local stdio use and integration testing now, while refusing a caller
without an OIDC subject (except the explicitly configured development subject).
"""

from .backend import TOOL_FAMILIES, TravelMcpBackend
from .core import BinaryUpload, ResponseValidationError
from .server import (
    _ADDITIVE_WRITE_TOOLS,
    MCP_CAPABILITY_CONTRACT_VERSION,
    MCP_TOOL_CAPABILITIES,
    MCP_VISIBLE_TOOLS,
    OutageAwareJWTVerifier,
    ToolFailureMiddleware,
    _tool_annotations,
    _unauthorized_reason,
    create_mcp_http_app,
    create_mcp_server,
    main,
    mcp_http_enabled,
    mount_mcp,
)
from .trips import BatchCreate

__all__ = [
    "MCP_CAPABILITY_CONTRACT_VERSION",
    "MCP_TOOL_CAPABILITIES",
    "MCP_VISIBLE_TOOLS",
    "TOOL_FAMILIES",
    "_ADDITIVE_WRITE_TOOLS",
    "BatchCreate",
    "BinaryUpload",
    "OutageAwareJWTVerifier",
    "ResponseValidationError",
    "ToolFailureMiddleware",
    "TravelMcpBackend",
    "_tool_annotations",
    "_unauthorized_reason",
    "create_mcp_http_app",
    "create_mcp_server",
    "main",
    "mcp_http_enabled",
    "mount_mcp",
]
