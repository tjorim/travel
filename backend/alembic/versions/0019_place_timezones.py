"""Give broad places an optional IANA time zone.

Revision ID: 0019_place_timezones
Revises: 0018_archive_parity
Create Date: 2026-09-23
"""

import sqlalchemy as sa

from alembic import op

revision = "0019_place_timezones"
down_revision = "0018_archive_parity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("places", sa.Column("timezone", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("places", "timezone")
