"""Add owner MCP invocation audit records.

Revision ID: 0016_mcp_audit_events
Revises: 0015_visitor_stories
Create Date: 2026-09-23
"""

import sqlalchemy as sa

from alembic import op

revision = "0016_mcp_audit_events"
down_revision = "0015_visitor_stories"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mcp_audit_events",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("owner_subject", sa.String(length=255), nullable=False),
        sa.Column("action", sa.String(length=120), nullable=False),
        sa.Column("resource_type", sa.String(length=80), nullable=False),
        sa.Column("resource_id", sa.String(length=64), nullable=True),
        sa.Column("trip_id", sa.String(length=32), nullable=True),
        sa.Column("result", sa.String(length=16), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_mcp_audit_events_owner_subject", "mcp_audit_events", ["owner_subject"])
    op.create_index("ix_mcp_audit_events_trip_id", "mcp_audit_events", ["trip_id"])


def downgrade() -> None:
    op.drop_index("ix_mcp_audit_events_trip_id", table_name="mcp_audit_events")
    op.drop_index("ix_mcp_audit_events_owner_subject", table_name="mcp_audit_events")
    op.drop_table("mcp_audit_events")
