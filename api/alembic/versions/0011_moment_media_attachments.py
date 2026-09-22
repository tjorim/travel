"""Add explicit owner-only media attachments to moments.

Revision ID: 0011_moment_media_attachments
Revises: 0010_osm_place_references
Create Date: 2026-09-22
"""

import sqlalchemy as sa

from alembic import op

revision = "0011_moment_media_attachments"
down_revision = "0010_osm_place_references"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "moment_media_assets",
        sa.Column("moment_id", sa.String(length=32), nullable=False),
        sa.Column("media_asset_id", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["moment_id"], ["moments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["media_asset_id"], ["media_assets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("moment_id", "media_asset_id"),
    )
    op.create_index("ix_moment_media_assets_media_asset_id", "moment_media_assets", ["media_asset_id"])


def downgrade() -> None:
    op.drop_index("ix_moment_media_assets_media_asset_id", table_name="moment_media_assets")
    op.drop_table("moment_media_assets")
