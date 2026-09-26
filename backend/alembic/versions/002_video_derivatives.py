"""Queue video derivatives and retain a stripped poster beside each copy.

Revision ID: 002_video_derivatives
Revises: 001_areas_locations_routes
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "002_video_derivatives"
down_revision = "001_areas_locations_routes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    state = postgresql.ENUM("processing", "failed", "ready", name="travel_derivative_processing_state", create_type=False)
    state.create(op.get_bind(), checkfirst=True)
    op.alter_column("media_derivatives", "object_id", existing_type=sa.String(32), nullable=True)
    # Trip-local dedup may reuse the same encoded copy or poster for multiple
    # purposes; a unique object reference would reject the second derivative.
    op.drop_constraint("media_derivatives_object_id_key", "media_derivatives", type_="unique")
    op.add_column("media_derivatives", sa.Column("poster_object_id", sa.String(32), nullable=True))
    op.add_column("media_derivatives", sa.Column("processing_state", state, nullable=False, server_default="ready"))
    op.add_column("media_derivatives", sa.Column("processing_started_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("media_derivatives", sa.Column("remove_audio", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("media_derivatives", sa.Column("duration_seconds", sa.Float(), nullable=True))
    op.create_foreign_key("media_derivatives_poster_object_id_fkey", "media_derivatives", "stored_objects", ["poster_object_id"], ["id"])


def downgrade() -> None:
    op.execute("DELETE FROM media_derivatives WHERE object_id IS NULL")
    op.drop_constraint("media_derivatives_poster_object_id_fkey", "media_derivatives", type_="foreignkey")
    for column in ("duration_seconds", "remove_audio", "processing_started_at", "processing_state", "poster_object_id"):
        op.drop_column("media_derivatives", column)
    op.alter_column("media_derivatives", "object_id", existing_type=sa.String(32), nullable=False)
    op.create_unique_constraint("media_derivatives_object_id_key", "media_derivatives", ["object_id"])
    postgresql.ENUM(name="travel_derivative_processing_state").drop(op.get_bind(), checkfirst=True)
