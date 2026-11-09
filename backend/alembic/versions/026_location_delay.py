"""Per-audience delayed location delivery (#332)."""

import sqlalchemy as sa

from alembic import op

revision = "026_location_delay"
down_revision = "025_live_tracks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("live_sessions", sa.Column("delays", sa.JSON(), nullable=False, server_default="{}"))


def downgrade() -> None:
    op.drop_column("live_sessions", "delays")
