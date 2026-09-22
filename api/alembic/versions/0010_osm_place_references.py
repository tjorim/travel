"""Add durable OSM references and selected display snapshots to exact places.

Revision ID: 0010_osm_place_references
Revises: 0009_generic_share_scopes
Create Date: 2026-09-22
"""

import sqlalchemy as sa

from alembic import op

revision = "0010_osm_place_references"
down_revision = "0009_generic_share_scopes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("places", sa.Column("osm_element_type", sa.String(length=12), nullable=True))
    op.add_column("places", sa.Column("osm_element_id", sa.String(length=32), nullable=True))
    op.add_column("places", sa.Column("display_name", sa.String(length=500), nullable=True))
    op.create_check_constraint(
        "ck_places_osm_reference_pair", "places", "(osm_element_type IS NULL) = (osm_element_id IS NULL)"
    )
    op.create_check_constraint(
        "ck_places_osm_element_type",
        "places",
        "osm_element_type IS NULL OR osm_element_type IN ('node', 'way', 'relation')",
    )
    op.create_index("ix_places_osm_element", "places", ["osm_element_type", "osm_element_id"])


def downgrade() -> None:
    op.drop_index("ix_places_osm_element", table_name="places")
    op.drop_constraint("ck_places_osm_element_type", "places", type_="check")
    op.drop_constraint("ck_places_osm_reference_pair", "places", type_="check")
    op.drop_column("places", "display_name")
    op.drop_column("places", "osm_element_id")
    op.drop_column("places", "osm_element_type")
