"""Save the canonical OpenStreetMap URL for referenced locations.

Revision ID: 008_location_osm_url
Revises: 007_packing_reuse
"""

import sqlalchemy as sa

from alembic import op

revision = "008_location_osm_url"
down_revision = "007_packing_reuse"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("locations", sa.Column("osm_url", sa.String(255), nullable=True))
    op.execute(
        "UPDATE locations SET osm_url = "
        "'https://www.openstreetmap.org/' || osm_element_type || '/' || osm_element_id "
        "WHERE osm_element_type IS NOT NULL AND osm_element_id IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_column("locations", "osm_url")
