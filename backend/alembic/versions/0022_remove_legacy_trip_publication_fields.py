"""Remove superseded trip-level sharing fields.

The scoped public surface and named share links are the only delivery gates.
The old trip visibility, publication state and public ID no longer influence
delivery, so retaining them invites contradictory owner settings.

Revision ID: 0022_remove_legacy_publication
Revises: 0021_task_alert_email
Create Date: 2026-09-24
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0022_remove_legacy_publication"
down_revision = "0021_task_alert_email"
branch_labels = None
depends_on = None


visibility = postgresql.ENUM("private", "unlisted", "public", name="travel_visibility", create_type=False)
publication_state = postgresql.ENUM("draft", "published", name="travel_publication_state", create_type=False)


def upgrade() -> None:
    op.drop_column("trips", "public_id")
    op.drop_column("trips", "publication_state")
    op.drop_column("trips", "visibility")
    publication_state.drop(op.get_bind(), checkfirst=True)
    visibility.drop(op.get_bind(), checkfirst=True)


def downgrade() -> None:
    visibility.create(op.get_bind(), checkfirst=True)
    publication_state.create(op.get_bind(), checkfirst=True)
    op.add_column("trips", sa.Column("visibility", visibility, server_default="private", nullable=False))
    op.add_column("trips", sa.Column("publication_state", publication_state, server_default="draft", nullable=False))
    op.add_column("trips", sa.Column("public_id", sa.String(length=32), nullable=True))
    op.create_unique_constraint("trips_public_id_key", "trips", ["public_id"])
    op.alter_column("trips", "visibility", server_default=None)
    op.alter_column("trips", "publication_state", server_default=None)
