"""Add personal packing templates and departure-day flags.

Revision ID: 007_packing_reuse
Revises: 006_packing
"""

import sqlalchemy as sa

from alembic import op

revision = "007_packing_reuse"
down_revision = "006_packing"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("packing_items", sa.Column("last_minute", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_table(
        "packing_templates",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("owner_subject", sa.String(255), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_packing_templates_owner_subject", "packing_templates", ["owner_subject"])


def downgrade() -> None:
    op.drop_table("packing_templates")
    op.drop_column("packing_items", "last_minute")
