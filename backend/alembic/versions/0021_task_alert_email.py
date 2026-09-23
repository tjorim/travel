"""Track private task-alert email delivery.

Revision ID: 0021_task_alert_email
Revises: 0020_task_alerts
"""

import sqlalchemy as sa

from alembic import op

revision = "0021_task_alert_email"
down_revision = "0020_task_alerts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("trip_task_alerts", sa.Column("email_sent_at", sa.DateTime(timezone=True)))
    op.add_column("trip_task_alerts", sa.Column("email_attempts", sa.Integer(), server_default="0", nullable=False))
    op.add_column("trip_task_alerts", sa.Column("email_last_error", sa.String(120)))


def downgrade() -> None:
    op.drop_column("trip_task_alerts", "email_last_error")
    op.drop_column("trip_task_alerts", "email_attempts")
    op.drop_column("trip_task_alerts", "email_sent_at")
