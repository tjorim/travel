"""Track when each language of an authored field was changed or reviewed (#437).

Existing timestamps stay null because the order of past edits is unknown.

Revision ID: 036_translation_freshness
Revises: 035_local_place_names
"""

import sqlalchemy as sa

from alembic import op

revision = "036_translation_freshness"
down_revision = "035_local_place_names"
branch_labels = None
depends_on = None

FIELDS = {
    "trips": ("title", "summary"),
    "collections": ("title",),
    "areas": ("label",),
    "locations": ("label",),
    "visits": ("title", "summary"),
    "routes": ("label",),
    "travel_updates": ("title", "body"),
    "media_derivatives": ("caption", "alt_text"),
}


def upgrade() -> None:
    for table, fields in FIELDS.items():
        for field in fields:
            for language in ("nl", "en"):
                column = sa.Column(f"{field}_{language}_updated_at", sa.DateTime(timezone=True))
                op.add_column(table, column, schema="public")


def downgrade() -> None:
    for table, fields in FIELDS.items():
        for field in fields:
            for language in ("nl", "en"):
                op.drop_column(table, f"{field}_{language}_updated_at", schema="public")
