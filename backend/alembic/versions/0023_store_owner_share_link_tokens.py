"""Keep active share URLs available to their owner.

Existing links keep their verifier but cannot be reconstructed from it; they
can be rotated once to receive a reusable owner-managed URL.

Revision ID: 0023_owner_share_tokens
Revises: 0022_remove_legacy_publication
Create Date: 2026-09-25
"""

import sqlalchemy as sa

from alembic import op

revision = "0023_owner_share_tokens"
down_revision = "0022_remove_legacy_publication"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("share_links", sa.Column("token", sa.String(length=128), nullable=True))


def downgrade() -> None:
    op.drop_column("share_links", "token")
