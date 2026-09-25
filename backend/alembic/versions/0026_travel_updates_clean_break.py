"""Make the reisupdate the only story record: a clean break from excerpts and highlights.

``moment_excerpts`` becomes ``travel_updates`` and a photo's link to it becomes
``travel_update_id``. Trip highlights are dropped without a replacement: the
reisupdate is the only story record. Stored public and link scopes cannot keep
the retired ``moment_excerpt`` and ``trip_highlight`` selections, since who sees
an update is now its own visibility. They are removed rather than translated, so
every existing update stays private until the owner chooses otherwise. A photo's
"moment" field becomes "update".

Revision ID: 0026_travel_updates
Revises: 0025_update_visibility
Create Date: 2026-09-25
"""

import sqlalchemy as sa

from alembic import op

revision = "0026_travel_updates"
down_revision = "0025_update_visibility"
branch_labels = None
depends_on = None

RETIRED_KINDS = {"moment_excerpt", "trip_highlight"}


def _rewrite_scopes(rename_field: tuple[str, str], drop_kinds: set[str]) -> None:
    bind = op.get_bind()
    for name in ("public_surfaces", "share_links"):
        key = "trip_id" if name == "public_surfaces" else "id"
        table = sa.table(name, sa.column(key, sa.String), sa.column("scope", sa.JSON))
        for row_id, scope in bind.execute(sa.select(table.c[key], table.c.scope)).all():
            if not isinstance(scope, dict) or not isinstance(scope.get("items"), list):
                continue
            items = [
                {**item, "fields": [rename_field[1] if field == rename_field[0] else field for field in item.get("fields", [])]}
                if item.get("kind") == "media_derivative" else item
                for item in scope["items"]
                if item.get("kind") not in drop_kinds
            ]
            bind.execute(sa.update(table).where(table.c[key] == row_id).values(scope={**scope, "items": items}))


def upgrade() -> None:
    # 0025 named the "reaches every audience" choice "shared", which also names
    # what a scope contains; "everyone" is the owner's word for it.
    op.execute("ALTER TYPE travel_update_visibility RENAME VALUE 'shared' TO 'everyone'")
    _rewrite_scopes(("moment", "update"), RETIRED_KINDS)

    op.drop_index("ix_trip_highlights_trip_id", table_name="trip_highlights")
    op.drop_table("trip_highlights")

    op.drop_constraint("fk_media_derivatives_moment_excerpt_id", "media_derivatives", type_="foreignkey")
    op.rename_table("moment_excerpts", "travel_updates")
    op.execute("ALTER INDEX ix_moment_excerpts_trip_id RENAME TO ix_travel_updates_trip_id")
    op.execute("ALTER TABLE travel_updates RENAME CONSTRAINT uq_moment_excerpts_share_id TO uq_travel_updates_share_id")
    op.alter_column("media_derivatives", "moment_excerpt_id", new_column_name="travel_update_id")
    op.create_foreign_key(
        "fk_media_derivatives_travel_update_id", "media_derivatives", "travel_updates", ["travel_update_id"], ["id"], ondelete="SET NULL"
    )


def downgrade() -> None:
    op.execute("ALTER TYPE travel_update_visibility RENAME VALUE 'everyone' TO 'shared'")
    op.drop_constraint("fk_media_derivatives_travel_update_id", "media_derivatives", type_="foreignkey")
    op.alter_column("media_derivatives", "travel_update_id", new_column_name="moment_excerpt_id")
    op.execute("ALTER TABLE travel_updates RENAME CONSTRAINT uq_travel_updates_share_id TO uq_moment_excerpts_share_id")
    op.execute("ALTER INDEX ix_travel_updates_trip_id RENAME TO ix_moment_excerpts_trip_id")
    op.rename_table("travel_updates", "moment_excerpts")
    op.create_foreign_key(
        "fk_media_derivatives_moment_excerpt_id", "media_derivatives", "moment_excerpts", ["moment_excerpt_id"], ["id"], ondelete="SET NULL"
    )

    op.create_table(
        "trip_highlights",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("trip_id", sa.String(length=32), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_trip_highlights_trip_id", "trip_highlights", ["trip_id"])
    # Removed selections cannot be restored; only the photo field name can.
    _rewrite_scopes(("update", "moment"), {"travel_update"})
