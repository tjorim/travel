"""Create the Travel tracker core tables.

Revision ID: 0001_tracker_initial
Revises:
Create Date: 2026-09-21
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0001_tracker_initial"
down_revision = None
branch_labels = None
depends_on = None


# Create each PostgreSQL named type explicitly once. The table columns use
# create_type=False so SQLAlchemy does not emit a duplicate CREATE TYPE while
# creating the first table that references it.
visibility = postgresql.ENUM("private", "unlisted", "public", name="travel_visibility", create_type=False)
publication_state = postgresql.ENUM("draft", "published", name="travel_publication_state", create_type=False)


def upgrade() -> None:
    visibility.create(op.get_bind(), checkfirst=True)
    publication_state.create(op.get_bind(), checkfirst=True)
    op.create_table(
        "places",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("display_name", sa.String(length=120), nullable=False),
        sa.Column("country_code", sa.String(length=2), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "trips",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("owner_subject", sa.String(length=255), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("visibility", visibility, nullable=False),
        sa.Column("publication_state", publication_state, nullable=False),
        sa.Column("public_id", sa.String(length=32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("public_id"),
    )
    op.create_index("ix_trips_owner_subject", "trips", ["owner_subject"])
    op.create_table(
        "route_stages",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("trip_id", sa.String(length=32), nullable=False),
        sa.Column("place_id", sa.String(length=32), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=True),
        sa.ForeignKeyConstraint(["place_id"], ["places.id"]),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("trip_id", "position", name="uq_route_stage_position"),
    )
    op.create_index("ix_route_stages_trip_id", "route_stages", ["trip_id"])
    op.create_table(
        "moments",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("trip_id", sa.String(length=32), nullable=False),
        sa.Column("place_id", sa.String(length=32), nullable=True),
        sa.Column("author_subject", sa.String(length=255), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("story", sa.Text(), nullable=False),
        sa.Column("photo_urls", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["place_id"], ["places.id"]),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_moments_trip_id", "moments", ["trip_id"])


def downgrade() -> None:
    op.drop_index("ix_moments_trip_id", table_name="moments")
    op.drop_table("moments")
    op.drop_index("ix_route_stages_trip_id", table_name="route_stages")
    op.drop_table("route_stages")
    op.drop_index("ix_trips_owner_subject", table_name="trips")
    op.drop_table("trips")
    op.drop_table("places")
    publication_state.drop(op.get_bind(), checkfirst=True)
    visibility.drop(op.get_bind(), checkfirst=True)
