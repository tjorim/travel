"""Rename a travel update's ``date_precision`` to ``share_date_precision`` (#386).

A visit and a stay already call their own cap on the date a visitor sees ``share_date_precision``, while the
visitor document uses ``date_precision`` for the *delivered* value. The update's setting now has the same name as
the visit's and stay's. The enum type ``travel_date_precision`` is shared by all three and stays.

Revision ID: 030_update_share_date_precision
Revises: 029_visit_order
"""

from alembic import op

revision = "030_update_share_date_precision"
down_revision = "029_visit_order"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE travel_updates RENAME COLUMN date_precision TO share_date_precision")


def downgrade() -> None:
    op.execute("ALTER TABLE travel_updates RENAME COLUMN share_date_precision TO date_precision")
