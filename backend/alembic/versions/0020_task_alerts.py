"""Add scheduled generic trip-task reminders and owner inbox alerts.

Revision ID: 0020_task_alerts
Revises: 0019_place_timezones
"""

import sqlalchemy as sa

from alembic import op

revision = "0020_task_alerts"
down_revision = "0019_place_timezones"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("trip_tasks", sa.Column("remind_at", sa.DateTime(timezone=True)))
    op.add_column("trip_tasks", sa.Column("reminded_at", sa.DateTime(timezone=True)))
    op.create_table(
        "trip_task_alerts",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("task_id", sa.String(32), sa.ForeignKey("trip_tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("owner_subject", sa.String(255), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("task_id", "kind", "scheduled_for", name="uq_trip_task_alert_schedule"),
    )
    op.create_index("ix_trip_task_alerts_task_id", "trip_task_alerts", ["task_id"])
    op.create_index("ix_trip_task_alerts_owner_subject", "trip_task_alerts", ["owner_subject"])


def downgrade() -> None:
    op.drop_index("ix_trip_task_alerts_owner_subject", "trip_task_alerts")
    op.drop_index("ix_trip_task_alerts_task_id", "trip_task_alerts")
    op.drop_table("trip_task_alerts")
    for column in ("reminded_at", "remind_at"):
        op.drop_column("trip_tasks", column)
