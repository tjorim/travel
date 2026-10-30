"""Store an unnamed area as no label instead of a language-bound fallback name.

Revision ID: 014_unnamed_areas
Revises: 013_scope_audit
"""

import sqlalchemy as sa

from alembic import op

revision = "014_unnamed_areas"
down_revision = "013_scope_audit"
branch_labels = None
depends_on = None

# The fallback names the server used to write or propose for an area without a name.
_FALLBACKS = ("Unassigned", "Nieuw gebied")


def upgrade() -> None:
    with op.batch_alter_table("areas") as batch:
        batch.alter_column("label", existing_type=sa.String(120), nullable=True)
    areas = sa.table("areas", sa.column("label", sa.String))
    op.execute(areas.update().where(areas.c.label.in_(_FALLBACKS)).values(label=None))


def downgrade() -> None:
    areas = sa.table("areas", sa.column("label", sa.String))
    op.execute(areas.update().where(areas.c.label.is_(None)).values(label=_FALLBACKS[0]))
    with op.batch_alter_table("areas") as batch:
        batch.alter_column("label", existing_type=sa.String(120), nullable=False)
