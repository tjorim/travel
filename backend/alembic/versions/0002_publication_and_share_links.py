"""Add live-scoped public-projection and revocable unlisted share-link tables.

Revision ID: 0002_publication_and_share_links
Revises: 0001_tracker_initial
Create Date: 2026-09-22
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0002_publication_and_share_links"
down_revision = "0001_tracker_initial"
branch_labels = None
depends_on = None


surface_state = postgresql.ENUM("unpublished", "published", name="travel_surface_state", create_type=False)
link_state = postgresql.ENUM("draft", "active", "revoked", "expired", name="travel_link_state", create_type=False)


def upgrade() -> None:
    surface_state.create(op.get_bind(), checkfirst=True)
    link_state.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "public_surfaces",
        sa.Column("trip_id", sa.String(length=32), nullable=False),
        sa.Column("slug", sa.String(length=32), nullable=False),
        sa.Column("state", surface_state, nullable=False),
        sa.Column("scope", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("trip_id"),
        sa.UniqueConstraint("slug"),
    )

    op.create_table(
        "share_links",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("trip_id", sa.String(length=32), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=False),
        sa.Column("state", link_state, nullable=False),
        sa.Column("scope", sa.JSON(), nullable=False),
        sa.Column("token_verifier", sa.String(length=64), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_verifier"),
    )
    op.create_index("ix_share_links_trip_id", "share_links", ["trip_id"])


def downgrade() -> None:
    op.drop_index("ix_share_links_trip_id", table_name="share_links")
    op.drop_table("share_links")
    op.drop_table("public_surfaces")

    link_state.drop(op.get_bind(), checkfirst=True)
    surface_state.drop(op.get_bind(), checkfirst=True)
