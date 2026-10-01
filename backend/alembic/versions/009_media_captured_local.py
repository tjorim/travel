"""Mark EXIF capture times as camera wall-clock times.

Revision ID: 009_media_captured_local
Revises: 008_location_osm_url
"""

import sqlalchemy as sa

from alembic import op

revision = "009_media_captured_local"
down_revision = "008_location_osm_url"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Existing rows keep their stored value as an instant: the original file is
    # the only record of whether a bare EXIF time was read, so it is not re-derived here.
    op.add_column(
        "media_assets",
        sa.Column("captured_local", sa.Boolean(), server_default=sa.false(), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("media_assets", "captured_local")
