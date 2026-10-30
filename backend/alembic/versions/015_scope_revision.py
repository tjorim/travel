"""Add sharing scope revisions."""

import sqlalchemy as sa

from alembic import op

revision = "015_scope_revision"
down_revision = "014_unnamed_areas"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("public_surfaces", "share_links"):
        op.add_column(table, sa.Column("revision", sa.Integer(), nullable=False, server_default="1"))


def downgrade() -> None:
    for table in ("share_links", "public_surfaces"):
        with op.batch_alter_table(table) as batch:
            batch.drop_column("revision")
