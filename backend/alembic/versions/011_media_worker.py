"""Persist private remote video work and its cleanup outbox (#457)."""

import sqlalchemy as sa

from alembic import op

revision = "011_media_worker"
down_revision = "010_planning_statuses"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "media_derivatives", sa.Column("processing_backend", sa.String(10), server_default="local", nullable=False)
    )
    op.create_table(
        "media_worker_jobs",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column(
            "derivative_id", sa.String(32), sa.ForeignKey("media_derivatives.id", ondelete="SET NULL"), unique=True
        ),
        sa.Column("worker_id", sa.String(32), unique=True),
        sa.Column("profile", sa.String(40), nullable=False),
        sa.Column("remove_audio", sa.Boolean(), nullable=False),
        sa.Column("source_key", sa.String(300), nullable=False),
        sa.Column("source_sha256", sa.String(64), nullable=False),
        sa.Column("state", sa.String(20), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("error_code", sa.String(40)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_media_worker_jobs_state", "media_worker_jobs", ["state"])
    op.create_index("ix_media_worker_jobs_next_attempt_at", "media_worker_jobs", ["next_attempt_at"])


def downgrade() -> None:
    op.drop_table("media_worker_jobs")
    op.drop_column("media_derivatives", "processing_backend")
