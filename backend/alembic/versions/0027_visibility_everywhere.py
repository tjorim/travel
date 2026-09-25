"""Give every shareable record the same private / everyone / custom choice.

A record's own ``visibility`` now decides who receives it, so twins that only
restated a private record at lower precision are gone: a broad stay card is
replaced by sharing the stay itself (its city and nights), and an exact place
can be shared under a public name. ``parent_exact_place_id`` was never set.

Scopes no longer carry per-field choices, so the old selections cannot be
translated without widening what visitors see. This is a clean break: every
stored public and link scope keeps its trip-level title, summary and dates and
loses its listed items, and every record starts ``private``. The owner chooses
again, once, with the new controls.

Revision ID: 0027_visibility_everywhere
Revises: 0026_travel_updates
Create Date: 2026-09-25
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0027_visibility_everywhere"
down_revision = "0026_travel_updates"
branch_labels = None
depends_on = None

VISIBLE_TABLES = (
    "places", "route_stages", "broad_routes", "stays", "transport_legs", "media_derivatives", "document_derivatives",
)
visibility = postgresql.ENUM("private", "everyone", "custom", name="travel_visibility", create_type=False)
date_precision = postgresql.ENUM("day", "month", "year", name="travel_date_precision", create_type=False)


def _clear_scope_items() -> None:
    bind = op.get_bind()
    for name in ("public_surfaces", "share_links"):
        key = "trip_id" if name == "public_surfaces" else "id"
        table = sa.table(name, sa.column(key, sa.String), sa.column("scope", sa.JSON))
        for row_id, scope in bind.execute(sa.select(table.c[key], table.c.scope)).all():
            if isinstance(scope, dict):
                bind.execute(sa.update(table).where(table.c[key] == row_id).values(scope={**scope, "items": []}))


def upgrade() -> None:
    op.execute("ALTER TYPE travel_update_visibility RENAME TO travel_visibility")
    for table in VISIBLE_TABLES:
        op.add_column(table, sa.Column("visibility", visibility, nullable=False, server_default="private"))
        op.alter_column(table, "visibility", server_default=None)
    op.add_column("stays", sa.Column("share_date_precision", date_precision, nullable=False, server_default="month"))
    op.alter_column("stays", "share_date_precision", server_default=None)
    _clear_scope_items()

    op.drop_index("ix_broad_stay_cards_trip_id", table_name="broad_stay_cards")
    op.drop_table("broad_stay_cards")
    op.drop_column("places", "parent_exact_place_id")


def downgrade() -> None:
    op.add_column(
        "places", sa.Column("parent_exact_place_id", sa.String(length=32), sa.ForeignKey("places.id"), nullable=True)
    )
    op.create_table(
        "broad_stay_cards",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("trip_id", sa.String(length=32), nullable=False),
        sa.Column("broad_place_id", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("date_precision", date_precision, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["broad_place_id"], ["places.id"]),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_broad_stay_cards_trip_id", "broad_stay_cards", ["trip_id"])

    op.drop_column("stays", "share_date_precision")
    for table in VISIBLE_TABLES:
        op.drop_column(table, "visibility")
    op.execute("ALTER TYPE travel_visibility RENAME TO travel_update_visibility")
