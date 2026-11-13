"""Identity and audit tools."""

from __future__ import annotations

from typing import Any

from pydantic import Field
from sqlalchemy import select

from ..models import McpAuditEvent
from .core import McpTools
from .rendering import _model


class IdentityTools(McpTools):
    """Identity and audit tools."""

    def whoami(self) -> dict[str, str]:
        """Show the authenticated owner subject; no token material is returned."""
        subject = self._subject()
        return {"subject": subject, "role": "owner"}

    def list_mcp_audit_events(self, limit: int = Field(default=50, ge=1, le=200)) -> list[dict[str, Any]]:
        """Read this owner's bounded MCP invocation history, newest first."""
        return self._call(
            "mcp_audit.list",
            "mcp_audit_event",
            None,
            None,
            lambda s, subject: list(
                s.scalars(
                    select(McpAuditEvent)
                    .where(McpAuditEvent.owner_subject == subject)
                    .order_by(McpAuditEvent.occurred_at.desc())
                    .limit(limit)
                )
            ),
            lambda rows: [_model(row) for row in rows],
        )
