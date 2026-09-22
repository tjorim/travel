"""Split places into the canonical exact/broad model and add moment_excerpts.

Revision ID: 0005_split_places_and_excerpts
Revises: 0004_audit_events
Create Date: 2026-09-22
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0005_split_places_and_excerpts"
down_revision = "0004_audit_events"
branch_labels = None
depends_on = None


place_kind = postgresql.ENUM("exact", "broad", name="travel_place_kind", create_type=False)
date_precision = postgresql.ENUM("day", "month", "year", name="travel_date_precision", create_type=False)


def upgrade() -> None:
    bind = op.get_bind()
    place_kind.create(bind, checkfirst=True)
    date_precision.create(bind, checkfirst=True)

    # No production data exists yet (v1 is local/test storage), so this is a
    # clean recreate rather than a data-preserving migration: the flat MVP
    # `places` table and the tables that reference it are dropped and
    # recreated in the canonical exact/broad shape.
    op.drop_table("moments")
    op.drop_table("route_stages")
    op.drop_table("places")

    op.create_table(
        "places",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("trip_id", sa.String(length=32), nullable=False),
        sa.Column("kind", place_kind, nullable=False),
        sa.Column("parent_exact_place_id", sa.String(length=32), nullable=True),
        sa.Column("label", sa.String(length=120), nullable=True),
        sa.Column("region", sa.String(length=120), nullable=True),
        sa.Column("country_code", sa.String(length=2), nullable=True),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("address_line1", sa.String(length=160), nullable=True),
        sa.Column("address_line2", sa.String(length=160), nullable=True),
        sa.Column("locality", sa.String(length=120), nullable=True),
        sa.Column("admin_area", sa.String(length=120), nullable=True),
        sa.Column("postal_code", sa.String(length=20), nullable=True),
        sa.Column("viewport_north", sa.Float(), nullable=True),
        sa.Column("viewport_south", sa.Float(), nullable=True),
        sa.Column("viewport_east", sa.Float(), nullable=True),
        sa.Column("viewport_west", sa.Float(), nullable=True),
        sa.Column("navigation_provider", sa.String(length=40), nullable=True),
        sa.Column("navigation_provider_place_id", sa.String(length=255), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["parent_exact_place_id"], ["places.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_places_trip_id", "places", ["trip_id"])

    op.create_table(
        "route_stages",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("trip_id", sa.String(length=32), nullable=False),
        sa.Column("broad_place_id", sa.String(length=32), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=True),
        sa.ForeignKeyConstraint(["broad_place_id"], ["places.id"]),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("trip_id", "position", name="uq_route_stage_position"),
    )
    op.create_index("ix_route_stages_trip_id", "route_stages", ["trip_id"])

    op.create_table(
        "moments",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("trip_id", sa.String(length=32), nullable=False),
        sa.Column("exact_place_id", sa.String(length=32), nullable=True),
        sa.Column("author_subject", sa.String(length=255), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("story", sa.Text(), nullable=False),
        sa.Column("photo_urls", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["exact_place_id"], ["places.id"]),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_moments_trip_id", "moments", ["trip_id"])

    op.create_table(
        "moment_excerpts",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("trip_id", sa.String(length=32), nullable=False),
        sa.Column("source_moment_id", sa.String(length=32), nullable=True),
        sa.Column("broad_place_id", sa.String(length=32), nullable=True),
        sa.Column("date_precision", date_precision, nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_moment_id"], ["moments.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["broad_place_id"], ["places.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_moment_excerpts_trip_id", "moment_excerpts", ["trip_id"])


def downgrade() -> None:
    op.drop_index("ix_moment_excerpts_trip_id", table_name="moment_excerpts")
    op.drop_table("moment_excerpts")
    op.drop_index("ix_moments_trip_id", table_name="moments")
    op.drop_table("moments")
    op.drop_index("ix_route_stages_trip_id", table_name="route_stages")
    op.drop_table("route_stages")
    op.drop_index("ix_places_trip_id", table_name="places")
    op.drop_table("places")

    date_precision.drop(op.get_bind(), checkfirst=True)
    place_kind.drop(op.get_bind(), checkfirst=True)

    op.create_table(
        "places",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("display_name", sa.String(length=120), nullable=False),
        sa.Column("country_code", sa.String(length=2), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
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
