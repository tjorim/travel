"""Record the delegated agent separately in the MCP audit trail.

Revision ID: 011_mcp_audit_actor
Revises: 010_planning_statuses
"""

import sqlalchemy as sa

from alembic import op

revision = "011_mcp_audit_actor"
down_revision = "010_planning_statuses"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("mcp_audit_events", sa.Column("actor_subject", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("mcp_audit_events", "actor_subject")
