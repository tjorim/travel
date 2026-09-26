"""Give visits an owner-only planning status.

Revision ID: 003_visit_status
Revises: 002_video_derivatives
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "003_visit_status"
down_revision = "002_video_derivatives"
branch_labels = None
depends_on = None


def upgrade() -> None:
    status = postgresql.ENUM("idea", "planned", "confirmed", name="travel_visit_status", create_type=False)
    status.create(op.get_bind(), checkfirst=True)
    op.add_column("visits", sa.Column("status", status, nullable=False, server_default="planned"))


def downgrade() -> None:
    op.drop_column("visits", "status")
    postgresql.ENUM(name="travel_visit_status").drop(op.get_bind(), checkfirst=True)
