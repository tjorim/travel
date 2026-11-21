"""``python -m app.mcp`` runs the authenticated local stdio MCP server (``python -m app.mcp_server`` is the documented entry
point and does the same)."""

from app.mcp.server import main

main()
