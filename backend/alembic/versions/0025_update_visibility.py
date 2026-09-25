"""Add a first-class visibility choice to shareable travel updates.

Revision ID: 0025_update_visibility
Revises: 0024_group_share_links
Create Date: 2026-09-25
"""

import sqlalchemy as sa

from alembic import op

revision = "0025_update_visibility"
down_revision = "0024_group_share_links"
branch_labels = None
depends_on = None


def upgrade() -> None:
    visibility = sa.Enum("private", "shared", "custom", name="travel_update_visibility")
    visibility.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "moment_excerpts",
        sa.Column("visibility", visibility, nullable=False, server_default="private"),
    )
    op.alter_column("moment_excerpts", "visibility", server_default=None)


def downgrade() -> None:
    op.drop_column("moment_excerpts", "visibility")
    sa.Enum("private", "shared", "custom", name="travel_update_visibility").drop(op.get_bind(), checkfirst=True)
