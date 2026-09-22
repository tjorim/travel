"""Rewrite legacy publication scopes as ``travel/share-scope@1``.

Revision ID: 0009_generic_share_scopes
Revises: 0008_owner_managed_documents
Create Date: 2026-09-22

There are expected to be no persisted public-surface or share-link scopes
outside test databases at this point (the same rollout assumption used by the
resource migrations). If a legacy row does exist, preserve the trip-level
choices and route stages. Legacy moments are intentionally omitted: moments
are owner-only in the canonical model and must be replaced by explicitly
authored ``moment_excerpt`` items before sharing.
"""

import json

import sqlalchemy as sa

from alembic import op

revision = "0009_generic_share_scopes"
down_revision = "0008_owner_managed_documents"
branch_labels = None
depends_on = None


def _new_scope(scope: object) -> dict:
    old = scope if isinstance(scope, dict) else {}
    return {
        "schema_version": "travel/share-scope@1",
        "trip": {
            "title": old.get("include_title", True),
            "summary": old.get("include_summary", True),
        },
        "items": [
            {"kind": "route_stage", "id": stage_id, "fields": ["position", "label", "place"]}
            for stage_id in old.get("route_stage_ids", [])
        ],
    }


def _old_scope(scope: object) -> dict:
    new = scope if isinstance(scope, dict) else {}
    trip = new.get("trip") if isinstance(new.get("trip"), dict) else {}
    return {
        "include_title": trip.get("title", True),
        "include_summary": trip.get("summary", True),
        "route_stage_ids": [
            item["id"]
            for item in new.get("items", [])
            if isinstance(item, dict) and item.get("kind") == "route_stage" and isinstance(item.get("id"), str)
        ],
        # Legacy moments are owner-only canonical records, while v1 scope
        # entries contain moment excerpts. They cannot be safely translated.
        "moment_ids": [],
    }


def _migrate_table(table: str, key: str, converter) -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.text(f"SELECT {key}, scope FROM {table}")).mappings()
    for row in rows:
        bind.execute(
            sa.text(f"UPDATE {table} SET scope = CAST(:scope AS jsonb) WHERE {key} = :key"),
            {"scope": json.dumps(converter(row["scope"])), "key": row[key]},
        )


def upgrade() -> None:
    _migrate_table("public_surfaces", "trip_id", _new_scope)
    _migrate_table("share_links", "id", _new_scope)


def downgrade() -> None:
    # This is necessarily lossy: legacy scope has nowhere to put the new
    # share-safe resources, and it must never turn an excerpt into a moment.
    _migrate_table("public_surfaces", "trip_id", _old_scope)
    _migrate_table("share_links", "id", _old_scope)
