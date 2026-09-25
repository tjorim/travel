"""Merge the private moment into the reisupdate: one record with a private and a shared part.

A moment (occurred_at, exact place, private story, attached media) becomes a
reisupdate that keeps its id, so day-plan links and attachments still point at
it. The moment's story becomes the update's ``private_notes``; its ``body``, the
text for visitors, starts empty and the update starts private, so nothing a
moment held can reach a visitor. An existing update's date becomes an
``occurred_at`` at noon UTC. Photo URL references, which nothing used, are
dropped. The ``source_moment_id`` link goes, since there is nothing to derive
from any more.

Revision ID: 0028_moment_to_update
Revises: 0027_visibility_everywhere
Create Date: 2026-09-25
"""

import sqlalchemy as sa

from alembic import op

revision = "0028_moment_to_update"
down_revision = "0027_visibility_everywhere"
branch_labels = None
depends_on = None


def _drop_foreign_keys(table: str, referred_table: str) -> None:
    for foreign_key in sa.inspect(op.get_bind()).get_foreign_keys(table):
        if foreign_key["referred_table"] == referred_table:
            op.drop_constraint(foreign_key["name"], table, type_="foreignkey")


def _moment_born() -> str:
    """Updates that were, or hold, private moment data (before the attachments table is renamed back)."""
    return (
        "u.private_notes IS NOT NULL OR u.exact_place_id IS NOT NULL "
        "OR u.id IN (SELECT travel_update_id FROM travel_update_media_assets)"
    )


def upgrade() -> None:
    op.execute("ALTER TYPE travel_itinerary_link_kind RENAME VALUE 'moment' TO 'travel_update'")

    op.add_column("travel_updates", sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("travel_updates", sa.Column("exact_place_id", sa.String(length=32), nullable=True))
    op.add_column("travel_updates", sa.Column("private_notes", sa.Text(), nullable=True))
    op.create_foreign_key("fk_travel_updates_exact_place_id", "travel_updates", "places", ["exact_place_id"], ["id"])
    op.execute(
        "UPDATE travel_updates SET occurred_at = COALESCE((story_date + time '12:00')::timestamp AT TIME ZONE 'UTC', created_at)"
    )
    op.execute(
        "INSERT INTO travel_updates (id, share_id, trip_id, exact_place_id, occurred_at, date_precision, title, body,"
        " private_notes, visibility, created_at, updated_at) "
        "SELECT id, md5(random()::text || id), trip_id, exact_place_id, occurred_at, 'day'::travel_date_precision, title,"
        " '', story, 'private'::travel_visibility, created_at, updated_at FROM moments"
    )
    op.alter_column("travel_updates", "occurred_at", nullable=False)

    # Attachments follow the moment to its reisupdate, which reuses the id.
    _drop_foreign_keys("moment_media_assets", "moments")
    op.rename_table("moment_media_assets", "travel_update_media_assets")
    op.alter_column("travel_update_media_assets", "moment_id", new_column_name="travel_update_id")
    op.execute("ALTER INDEX ix_moment_media_assets_media_asset_id RENAME TO ix_travel_update_media_assets_media_asset_id")
    op.execute("ALTER TABLE travel_update_media_assets RENAME CONSTRAINT moment_media_assets_pkey TO travel_update_media_assets_pkey")
    op.create_foreign_key(
        "fk_travel_update_media_assets_travel_update_id", "travel_update_media_assets", "travel_updates",
        ["travel_update_id"], ["id"], ondelete="CASCADE",
    )

    _drop_foreign_keys("travel_updates", "moments")
    op.drop_column("travel_updates", "source_moment_id")
    op.drop_column("travel_updates", "story_date")
    op.drop_index("ix_moments_trip_id", table_name="moments")
    op.drop_table("moments")


def downgrade() -> None:
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
    # Updates that were, or hold, private moment data go back to being moments.
    op.execute(
        "INSERT INTO moments (id, trip_id, exact_place_id, author_subject, occurred_at, title, story, photo_urls,"
        " created_at, updated_at) "
        "SELECT u.id, u.trip_id, u.exact_place_id, t.owner_subject, u.occurred_at, u.title,"
        " COALESCE(u.private_notes, NULLIF(u.body, ''), u.title), '[]'::json, u.created_at, u.updated_at "
        f"FROM travel_updates u JOIN trips t ON t.id = u.trip_id WHERE {_moment_born()}"
    )

    op.drop_constraint("fk_travel_update_media_assets_travel_update_id", "travel_update_media_assets", type_="foreignkey")
    op.execute("ALTER TABLE travel_update_media_assets RENAME CONSTRAINT travel_update_media_assets_pkey TO moment_media_assets_pkey")
    op.execute("ALTER INDEX ix_travel_update_media_assets_media_asset_id RENAME TO ix_moment_media_assets_media_asset_id")
    op.alter_column("travel_update_media_assets", "travel_update_id", new_column_name="moment_id")
    op.rename_table("travel_update_media_assets", "moment_media_assets")
    op.create_foreign_key(
        "moment_media_assets_moment_id_fkey", "moment_media_assets", "moments", ["moment_id"], ["id"], ondelete="CASCADE"
    )

    op.add_column("travel_updates", sa.Column("story_date", sa.Date(), nullable=True))
    op.add_column("travel_updates", sa.Column("source_moment_id", sa.String(length=32), nullable=True))
    op.execute("UPDATE travel_updates SET story_date = (occurred_at AT TIME ZONE 'UTC')::date")
    # The moments copied above carry the same ids; the updates they came from are now redundant.
    op.execute("DELETE FROM travel_updates WHERE id IN (SELECT id FROM moments)")
    op.create_foreign_key(
        "travel_updates_source_moment_id_fkey", "travel_updates", "moments", ["source_moment_id"], ["id"], ondelete="SET NULL"
    )
    op.drop_constraint("fk_travel_updates_exact_place_id", "travel_updates", type_="foreignkey")
    op.drop_column("travel_updates", "private_notes")
    op.drop_column("travel_updates", "exact_place_id")
    op.drop_column("travel_updates", "occurred_at")

    op.execute("ALTER TYPE travel_itinerary_link_kind RENAME VALUE 'travel_update' TO 'moment'")
