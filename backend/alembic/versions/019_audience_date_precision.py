"""Let visits and stays follow the date precision of the audience.

``share_date_precision`` becomes nullable: ``NULL`` means "follow the audience".
Every existing row keeps its explicit value, so nothing a live audience receives
changes. The downgrade never widens: a followed record becomes ``month`` (the old
default) and every record is also held to the coarsest date precision any
audience of its trip sets, because the older code ignores that audience setting.
"""

import json

import sqlalchemy as sa

from alembic import op

revision = "019_audience_date_precision"
down_revision = "018_collections"
branch_labels = None
depends_on = None

_KIND = "record.precision_follow_audience"
_KINDS = (
    "public_projection.publish",
    "public_projection.unpublish",
    "share_link.create",
    "share_link.activate",
    "share_link.revoke",
    "share_link.rotate",
    "share_link.expire",
    "location.merge",
    "area.merge",
    "location.update",
    "public_projection.scope_change",
    "share_link.scope_change",
    "record.visibility_change",
)
_COARSENESS = {"day": 0, "month": 1, "year": 2}
_RECORD_TABLES = ("visits", "stays")


def upgrade() -> None:
    for table in _RECORD_TABLES:
        op.alter_column(table, "share_date_precision", nullable=True)
    with op.get_context().autocommit_block():
        op.execute(f"ALTER TYPE public.travel_audit_event_kind ADD VALUE IF NOT EXISTS '{_KIND}'")


def _audience_caps() -> dict[str, str]:
    """The coarsest date precision any audience of each trip sets, by trip id."""
    connection = op.get_bind()
    caps: dict[str, str] = {}
    queries = (
        "SELECT trip_id, scope FROM public.public_surfaces",
        "SELECT trip_id, scope FROM public.share_links",
        "SELECT trip_id, scope FROM public.collection_members",
    )
    for query in queries:
        for trip_id, scope in connection.execute(sa.text(query)):
            scope = json.loads(scope) if isinstance(scope, str) else scope
            cap = ((scope or {}).get("defaults") or {}).get("date_precision")
            if cap in _COARSENESS and _COARSENESS[cap] > _COARSENESS.get(caps.get(trip_id, "day"), 0):
                caps[trip_id] = cap
    return caps


def downgrade() -> None:
    caps = _audience_caps()
    for table in _RECORD_TABLES:
        op.execute(f"UPDATE public.{table} SET share_date_precision = 'month' WHERE share_date_precision IS NULL")
        for trip_id, cap in caps.items():
            held = [value for value, rank in _COARSENESS.items() if rank < _COARSENESS[cap]]
            if held:
                listed = ", ".join(f"'{value}'" for value in held)
                op.get_bind().execute(
                    sa.text(
                        f"UPDATE public.{table} SET share_date_precision = :cap "
                        f"WHERE trip_id = :trip_id AND share_date_precision IN ({listed})"
                    ),
                    {"cap": cap, "trip_id": trip_id},
                )
        op.alter_column(table, "share_date_precision", nullable=False)
    op.execute(f"DELETE FROM public.audit_events WHERE kind = '{_KIND}'")
    listed = ", ".join(f"'{value}'" for value in _KINDS)
    op.execute("ALTER TYPE public.travel_audit_event_kind RENAME TO travel_audit_event_kind_old")
    op.execute(f"CREATE TYPE public.travel_audit_event_kind AS ENUM ({listed})")
    op.execute(
        "ALTER TABLE public.audit_events ALTER COLUMN kind "
        "TYPE public.travel_audit_event_kind USING kind::text::public.travel_audit_event_kind"
    )
    op.execute("DROP TYPE public.travel_audit_event_kind_old")
