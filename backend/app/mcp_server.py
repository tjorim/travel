"""The MCP entry point: ``python -m app.mcp_server`` and ``from app.mcp_server import ...``.

The server lives in the ``app.mcp`` package (one module per tool family). This module is kept at its old path because
MCP clients and the documentation start the stdio server with ``python -m app.mcp_server`` and import its names from
here; it only re-exports them. Application code imports ``app.mcp``."""

from app.mcp import (
    _ADDITIVE_WRITE_TOOLS,
    MCP_CAPABILITY_CONTRACT_VERSION,
    MCP_TOOL_CAPABILITIES,
    MCP_VISIBLE_TOOLS,
    TOOL_FAMILIES,
    BatchCreate,
    BinaryUpload,
    OutageAwareJWTVerifier,
    ResponseValidationError,
    ToolFailureMiddleware,
    TravelMcpBackend,
    _tool_annotations,
    _unauthorized_reason,
    create_mcp_http_app,
    create_mcp_server,
    main,
    mcp_http_enabled,
    mount_mcp,
)

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

if __name__ == "__main__":
    main()
