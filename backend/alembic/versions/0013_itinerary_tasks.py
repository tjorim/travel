"""Add owner-only itinerary day-plan entries and trip tasks.

Revision ID: 0013_itinerary_tasks
Revises: 0012_transport_legs
Create Date: 2026-09-22
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0013_itinerary_tasks"
down_revision = "0012_transport_legs"
branch_labels = None
depends_on = None


itinerary_link_kind = postgresql.ENUM(
    "stay", "transport_leg", "route_stage", "place", "document", "moment",
    name="travel_itinerary_link_kind", create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    itinerary_link_kind.create(bind, checkfirst=True)

    op.create_table(
        "itinerary_entries",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("trip_id", sa.String(length=32), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("day_date", sa.Date(), nullable=True),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("linked_kind", itinerary_link_kind, nullable=True),
        sa.Column("linked_id", sa.String(length=32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("trip_id", "position", name="uq_itinerary_entry_position"),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_itinerary_entries_trip_id", "itinerary_entries", ["trip_id"])

    op.create_table(
        "trip_tasks",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("trip_id", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_trip_tasks_trip_id", "trip_tasks", ["trip_id"])


def downgrade() -> None:
    op.drop_index("ix_trip_tasks_trip_id", table_name="trip_tasks")
    op.drop_table("trip_tasks")
    op.drop_index("ix_itinerary_entries_trip_id", table_name="itinerary_entries")
    op.drop_table("itinerary_entries")
    itinerary_link_kind.drop(op.get_bind(), checkfirst=True)
