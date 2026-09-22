"""Add the owner-only audit_event table for publication and share-link
lifecycle transitions.

Revision ID: 0004_audit_events
Revises: 0003_media_ingestion
Create Date: 2026-09-22
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0004_audit_events"
down_revision = "0003_media_ingestion"
branch_labels = None
depends_on = None


audit_event_kind = postgresql.ENUM(
    "public_projection.publish",
    "public_projection.unpublish",
    "share_link.create",
    "share_link.activate",
    "share_link.revoke",
    "share_link.rotate",
    "share_link.expire",
    name="travel_audit_event_kind",
    create_type=False,
)
audit_target_type = postgresql.ENUM(
    "public_surface", "share_link", name="travel_audit_target_type", create_type=False
)


def upgrade() -> None:
    bind = op.get_bind()
    audit_event_kind.create(bind, checkfirst=True)
    audit_target_type.create(bind, checkfirst=True)

    op.create_table(
        "audit_events",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("trip_id", sa.String(length=32), nullable=False),
        sa.Column("actor_subject", sa.String(length=255), nullable=False),
        sa.Column("kind", audit_event_kind, nullable=False),
        sa.Column("target_type", audit_target_type, nullable=False),
        sa.Column("target_id", sa.String(length=32), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_events_trip_id", "audit_events", ["trip_id"])


def downgrade() -> None:
    op.drop_index("ix_audit_events_trip_id", table_name="audit_events")
    op.drop_table("audit_events")

    audit_target_type.drop(op.get_bind(), checkfirst=True)
    audit_event_kind.drop(op.get_bind(), checkfirst=True)
