"""Opt-in owner-only exact tracks (#244)."""

import sqlalchemy as sa

from alembic import op

revision = "025_live_tracks"
down_revision = "024_atom_feeds"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "live_sessions",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("trip_id", sa.String(32), sa.ForeignKey("trips.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source", sa.String(128), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("watermark", sa.DateTime(timezone=True)),
        sa.Column("accepted_at", sa.DateTime(timezone=True)),
        sa.Column("current_id", sa.String(32)),
        sa.Column("audiences", sa.JSON(), nullable=False),
    )
    op.create_index("ix_live_sessions_trip_id", "live_sessions", ["trip_id"])
    op.create_table(
        "live_points",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("session_id", sa.String(32), sa.ForeignKey("live_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.UniqueConstraint("session_id", "observed_at"),
        sa.CheckConstraint("latitude >= -90 AND latitude <= 90"),
        sa.CheckConstraint("longitude >= -180 AND longitude <= 180"),
    )
    op.create_index("ix_live_points_session_id_id", "live_points", ["session_id", "id"])


def downgrade() -> None:
    op.drop_table("live_points")
    op.drop_table("live_sessions")
