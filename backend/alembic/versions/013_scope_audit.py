"""Record scope and visibility changes in the sharing audit trail.

Revision ID: 013_scope_audit
Revises: 012_trip_cover
"""

from alembic import op

revision = "013_scope_audit"
down_revision = "012_trip_cover"
branch_labels = None
depends_on = None

_NEW_KINDS = ("public_projection.scope_change", "share_link.scope_change", "record.visibility_change")
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
)
_TARGETS = ("public_surface", "share_link", "location", "area")


def upgrade() -> None:
    with op.get_context().autocommit_block():
        for kind in _NEW_KINDS:
            op.execute(f"ALTER TYPE public.travel_audit_event_kind ADD VALUE IF NOT EXISTS '{kind}'")
        op.execute("ALTER TYPE public.travel_audit_target_type ADD VALUE IF NOT EXISTS 'record'")


def _rebuild(type_name: str, column: str, values: tuple[str, ...]) -> None:
    """PostgreSQL cannot drop an enum value, so recreate the type without it."""
    listed = ", ".join(f"'{value}'" for value in values)
    op.execute(f"ALTER TYPE public.{type_name} RENAME TO {type_name}_old")
    op.execute(f"CREATE TYPE public.{type_name} AS ENUM ({listed})")
    op.execute(
        f"ALTER TABLE public.audit_events ALTER COLUMN {column} "
        f"TYPE public.{type_name} USING {column}::text::public.{type_name}"
    )
    op.execute(f"DROP TYPE public.{type_name}_old")


def downgrade() -> None:
    op.execute(
        "DELETE FROM public.audit_events "
        "WHERE kind IN ('public_projection.scope_change', 'share_link.scope_change', 'record.visibility_change') "
        "OR target_type = 'record'"
    )
    _rebuild("travel_audit_event_kind", "kind", _KINDS)
    _rebuild("travel_audit_target_type", "target_type", _TARGETS)
