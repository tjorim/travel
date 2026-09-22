"""Add private raw recorded tracks and authored broad routes.

Revision ID: 0007_recorded_tracks_and_broad_routes
Revises: 0006_stays_and_broad_stay_cards
Create Date: 2026-09-22
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0007_recorded_tracks_and_broad_routes"
down_revision = "0006_stays_and_broad_stay_cards"
branch_labels = None
depends_on = None

track_kind = postgresql.ENUM("gpx", "point_array", name="travel_track_kind", create_type=False)
date_precision = postgresql.ENUM("day", "month", "year", name="travel_date_precision", create_type=False)


def upgrade() -> None:
    track_kind.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "recorded_tracks",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("trip_id", sa.String(length=32), nullable=False),
        sa.Column("source_object_id", sa.String(length=32), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("kind", track_kind, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("ended_at > started_at", name="ck_track_end_after_start"),
        sa.ForeignKeyConstraint(["source_object_id"], ["stored_objects.id"]),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source_object_id"),
    )
    op.create_index("ix_recorded_tracks_trip_id", "recorded_tracks", ["trip_id"])

    op.create_table(
        "broad_routes",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("trip_id", sa.String(length=32), nullable=False),
        sa.Column("label", sa.String(length=160), nullable=False),
        sa.Column("geometry", sa.JSON(), nullable=False),
        sa.Column("date_precision", date_precision, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_broad_routes_trip_id", "broad_routes", ["trip_id"])


def downgrade() -> None:
    op.drop_index("ix_broad_routes_trip_id", table_name="broad_routes")
    op.drop_table("broad_routes")
    op.drop_index("ix_recorded_tracks_trip_id", table_name="recorded_tracks")
    op.drop_table("recorded_tracks")
    track_kind.drop(op.get_bind(), checkfirst=True)
