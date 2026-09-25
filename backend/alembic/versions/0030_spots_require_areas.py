"""Require an area for every spot.

Revision ID: 0030_spots_require_areas
Revises: 0029_areas_hold_spots
Create Date: 2026-09-25
"""

import uuid

import sqlalchemy as sa

from alembic import op

revision = "0030_spots_require_areas"
down_revision = "0029_areas_hold_spots"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """File legacy address-less spots under one private area per trip."""
    bind = op.get_bind()
    trip_ids = bind.execute(
        sa.text("SELECT DISTINCT trip_id FROM places WHERE kind = 'exact' AND area_id IS NULL")
    ).scalars()
    for trip_id in trip_ids:
        area_id = bind.execute(
            sa.text(
                "SELECT id FROM places "
                "WHERE trip_id = :trip_id AND kind = 'broad' AND lower(label) = 'unassigned' "
                "ORDER BY created_at LIMIT 1"
            ),
            {"trip_id": trip_id},
        ).scalar()
        if area_id is None:
            area_id = uuid.uuid4().hex
            bind.execute(
                sa.text(
                    "INSERT INTO places (id, trip_id, kind, visibility, label, share_address) "
                    "VALUES (:id, :trip_id, 'broad'::travel_place_kind, 'private'::travel_visibility, 'Unassigned', false)"
                ),
                {"id": area_id, "trip_id": trip_id},
            )
        bind.execute(
            sa.text("UPDATE places SET area_id = :area_id WHERE trip_id = :trip_id AND kind = 'exact' AND area_id IS NULL"),
            {"area_id": area_id, "trip_id": trip_id},
        )
    op.create_check_constraint(
        "ck_places_spot_has_area",
        "places",
        "(kind = 'broad' AND area_id IS NULL) OR (kind = 'exact' AND area_id IS NOT NULL)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_places_spot_has_area", "places", type_="check")
