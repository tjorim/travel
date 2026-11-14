"""Align the three audit tables and let sharing audit events outlive their trip (#364).

* ``audit_events.kind`` and ``target_type`` become plain strings, like the kinds of the collection audit table. The
  code list lives in ``app.models`` and is validated when a row is written, so a new kind needs no migration. The
  PostgreSQL enum types are dropped.
* ``audit_events.trip_id`` stops being a foreign key with ``ON DELETE CASCADE``. Sharing events keep only ids, so they
  stay until their 24-month expiry (decision 36), like the collection and owner activity events.
* ``mcp_audit_events`` is renamed ``owner_activity_events``: the HTTP trip export and PDF export write to it too. The
  transport (``mcp`` or ``http``) moves out of ``details`` into its own column.
* The preset kind ``audience.preset_apply`` is split by what it targeted (``public_projection.preset_apply`` or
  ``share_link.preset_apply``), the way every other kind of those audiences is named.

Downgrade restores the enum types, the foreign key and ``details.transport``. It deletes the sharing events of trips
that no longer exist (a foreign key cannot hold them) and any row whose kind or target type the older schema did not
know.

Revision ID: 031_audit_alignment
Revises: 030_update_share_date_precision
"""

from alembic import op

revision = "031_audit_alignment"
down_revision = "030_update_share_date_precision"
branch_labels = None
depends_on = None

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
    "public_projection.scope_change",
    "share_link.scope_change",
    "record.visibility_change",
    "location.update",
    "record.precision_follow_audience",
    "alternative_group.choose",
    "alternative_group.undo_choice",
    "audience.preset_apply",
    "feed.enable",
    "feed.rotate",
    "feed.revoke",
)
_TARGET_TYPES = ("public_surface", "share_link", "location", "area", "record", "alternative_group")


def _literals(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{value}'" for value in values)


def upgrade() -> None:
    op.execute("ALTER TABLE public.audit_events DROP CONSTRAINT audit_events_trip_id_fkey")
    op.execute("ALTER TABLE public.audit_events ALTER COLUMN kind TYPE varchar(60) USING kind::text")
    op.execute("ALTER TABLE public.audit_events ALTER COLUMN target_type TYPE varchar(32) USING target_type::text")
    op.execute("DROP TYPE public.travel_audit_event_kind")
    op.execute("DROP TYPE public.travel_audit_target_type")
    op.execute(
        "UPDATE public.audit_events SET kind = CASE target_type WHEN 'public_surface' "
        "THEN 'public_projection.preset_apply' ELSE 'share_link.preset_apply' END "
        "WHERE kind = 'audience.preset_apply'"
    )

    op.execute("ALTER TABLE public.mcp_audit_events RENAME TO owner_activity_events")
    op.execute(
        "ALTER TABLE public.owner_activity_events RENAME CONSTRAINT mcp_audit_events_pkey TO owner_activity_events_pkey"
    )
    op.execute("ALTER INDEX public.ix_mcp_audit_events_owner_subject RENAME TO ix_owner_activity_events_owner_subject")
    op.execute("ALTER INDEX public.ix_mcp_audit_events_trip_id RENAME TO ix_owner_activity_events_trip_id")
    op.execute("ALTER TABLE public.owner_activity_events ADD COLUMN transport varchar(16)")
    op.execute(
        "UPDATE public.owner_activity_events SET transport = CASE WHEN details::jsonb ->> 'transport' = 'http' "
        "THEN 'http' ELSE 'mcp' END"
    )
    op.execute("ALTER TABLE public.owner_activity_events ALTER COLUMN transport SET NOT NULL")
    op.execute("UPDATE public.owner_activity_events SET details = (details::jsonb - 'transport')::json")


def downgrade() -> None:
    op.execute(
        "UPDATE public.owner_activity_events SET details = "
        "(details::jsonb || jsonb_build_object('transport', transport))::json"
    )
    op.execute("ALTER TABLE public.owner_activity_events DROP COLUMN transport")
    op.execute("ALTER INDEX public.ix_owner_activity_events_trip_id RENAME TO ix_mcp_audit_events_trip_id")
    op.execute("ALTER INDEX public.ix_owner_activity_events_owner_subject RENAME TO ix_mcp_audit_events_owner_subject")
    op.execute(
        "ALTER TABLE public.owner_activity_events RENAME CONSTRAINT owner_activity_events_pkey TO mcp_audit_events_pkey"
    )
    op.execute("ALTER TABLE public.owner_activity_events RENAME TO mcp_audit_events")

    op.execute(
        "UPDATE public.audit_events SET kind = 'audience.preset_apply' "
        "WHERE kind IN ('public_projection.preset_apply', 'share_link.preset_apply')"
    )
    op.execute(
        f"DELETE FROM public.audit_events WHERE kind NOT IN ({_literals(_KINDS)}) "
        f"OR target_type NOT IN ({_literals(_TARGET_TYPES)}) "
        "OR trip_id NOT IN (SELECT id FROM public.trips)"
    )
    op.execute(f"CREATE TYPE public.travel_audit_event_kind AS ENUM ({_literals(_KINDS)})")
    op.execute(f"CREATE TYPE public.travel_audit_target_type AS ENUM ({_literals(_TARGET_TYPES)})")
    op.execute(
        "ALTER TABLE public.audit_events ALTER COLUMN kind TYPE public.travel_audit_event_kind "
        "USING kind::public.travel_audit_event_kind"
    )
    op.execute(
        "ALTER TABLE public.audit_events ALTER COLUMN target_type TYPE public.travel_audit_target_type "
        "USING target_type::public.travel_audit_target_type"
    )
    op.execute(
        "ALTER TABLE public.audit_events ADD CONSTRAINT audit_events_trip_id_fkey "
        "FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE"
    )
