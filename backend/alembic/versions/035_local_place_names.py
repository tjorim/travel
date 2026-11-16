"""Let an area and a location hold the name its place goes by locally (#376).

``local_name`` is a third kind of name next to the Dutch and English labels: the name as written where the place
is, which is not a translation and is often not in Latin script. It is nullable and owner-editable, and only an
owner's choice puts text in it. Existing rows start without one, so nothing reads differently.

The downgrade drops the column; the local names are the only loss.

Revision ID: 035_local_place_names
Revises: 034_bilingual_texts
"""

from alembic import op

revision = "035_local_place_names"
down_revision = "034_bilingual_texts"
branch_labels = None
depends_on = None

TABLES = ("areas", "locations")


def upgrade() -> None:
    for table in TABLES:
        op.execute(f"ALTER TABLE public.{table} ADD COLUMN local_name character varying(120)")


def downgrade() -> None:
    for table in TABLES:
        op.execute(f"ALTER TABLE public.{table} DROP COLUMN local_name")
