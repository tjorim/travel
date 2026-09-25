"""An area holds spots, and a shared spot can also show its address.

Every existing spot is filed under an area found or made from its own city: an
area of the same trip with the same name (and a compatible country) is reused,
otherwise a new private area is created. A spot with no city stays without an
area until the owner picks one. Nothing becomes shared: the address choice
starts off, so a shared spot still shows only its public name, city and point.

Revision ID: 0029_areas_hold_spots
Revises: 0028_moment_to_update
Create Date: 2026-09-25
"""

import uuid

import sqlalchemy as sa

from alembic import op

revision = "0029_areas_hold_spots"
down_revision = "0028_moment_to_update"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("places", sa.Column("area_id", sa.String(length=32), nullable=True))
    op.create_foreign_key("fk_places_area_id", "places", "places", ["area_id"], ["id"])
    op.add_column("places", sa.Column("share_address", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.alter_column("places", "share_address", server_default=None)

    bind = op.get_bind()
    spots = bind.execute(
        sa.text("SELECT id, trip_id, locality, admin_area, country_code FROM places WHERE kind = 'exact' ORDER BY created_at")
    ).all()
    areas: dict[str, list[tuple[str, str, str | None]]] = {}
    for area_id, trip_id, label, country_code in bind.execute(
        sa.text("SELECT id, trip_id, label, country_code FROM places WHERE kind = 'broad'")
    ):
        areas.setdefault(trip_id, []).append((area_id, (label or "").strip().lower(), country_code))
    for spot_id, trip_id, locality, admin_area, country_code in spots:
        name = (locality or admin_area or "").strip()
        if not name:
            continue
        match = next(
            (area_id for area_id, label, area_country in areas.get(trip_id, [])
             if label == name.lower() and (not area_country or not country_code or area_country == country_code)),
            None,
        )
        if match is None:
            match = uuid.uuid4().hex
            bind.execute(
                sa.text(
                    "INSERT INTO places (id, trip_id, kind, visibility, label, country_code, region, share_address)"
                    " VALUES (:id, :trip_id, 'broad'::travel_place_kind, 'private'::travel_visibility, :label, :country, :region, false)"
                ),
                {"id": match, "trip_id": trip_id, "label": name[:120], "country": country_code, "region": admin_area if locality else None},
            )
            areas.setdefault(trip_id, []).append((match, name.lower(), country_code))
        bind.execute(sa.text("UPDATE places SET area_id = :area WHERE id = :spot"), {"area": match, "spot": spot_id})


def downgrade() -> None:
    op.drop_column("places", "share_address")
    op.drop_constraint("fk_places_area_id", "places", type_="foreignkey")
    op.drop_column("places", "area_id")
