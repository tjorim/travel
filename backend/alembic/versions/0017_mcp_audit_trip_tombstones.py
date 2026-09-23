"""Retain MCP audit trip identifiers after trip deletion.

Revision ID: 0017_mcp_audit_trip_tombstones
Revises: 0016_mcp_audit_events
"""

import sqlalchemy as sa

from alembic import op

revision = "0017_mcp_audit_trip_tombstones"
down_revision = "0016_mcp_audit_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("mcp_audit_events_trip_id_fkey", "mcp_audit_events", type_="foreignkey")


def downgrade() -> None:
    # The previous schema cannot represent historical trip ids after deletion.
    op.execute(
        sa.text("""
            UPDATE mcp_audit_events AS event
            SET trip_id = NULL
            WHERE trip_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM trips WHERE trips.id = event.trip_id)
        """)
    )
    op.create_foreign_key(
        "mcp_audit_events_trip_id_fkey", "mcp_audit_events", "trips", ["trip_id"], ["id"], ondelete="SET NULL"
    )
