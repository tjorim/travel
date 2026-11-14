"""Identity and audit tools."""

from __future__ import annotations

from typing import Any

from pydantic import Field
from sqlalchemy import select

from ..models import OwnerActivityEvent
from .core import McpTools
from .rendering import _model


class IdentityTools(McpTools):
    """Identity and audit tools."""

    def whoami(self) -> dict[str, str]:
        """Show the authenticated owner subject; no token material is returned."""
        subject = self._subject()
        return {"subject": subject, "role": "owner"}

    def list_mcp_audit_events(self, limit: int = Field(default=50, ge=1, le=200)) -> list[dict[str, Any]]:
        """Read this owner's bounded activity history, newest first: MCP calls and HTTP exports, each naming its transport."""
        return self._call(
            "mcp_audit.list",
            "mcp_audit_event",
            None,
            None,
            lambda s, subject: list(
                s.scalars(
                    select(OwnerActivityEvent)
                    .where(OwnerActivityEvent.owner_subject == subject)
                    .order_by(OwnerActivityEvent.occurred_at.desc())
                    .limit(limit)
                )
            ),
            lambda rows: [_model(row) for row in rows],
        )
