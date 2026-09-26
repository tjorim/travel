"""Record location and area merges in the trip audit trail.

Revision ID: 004_merge_audit
Revises: 003_visit_status
"""

from alembic import op

revision = "004_merge_audit"
down_revision = "003_visit_status"
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
)
_TARGETS = ("public_surface", "share_link")


def upgrade() -> None:
    with op.get_context().autocommit_block():
        for kind in ("location.merge", "area.merge"):
            op.execute(f"ALTER TYPE public.travel_audit_event_kind ADD VALUE IF NOT EXISTS '{kind}'")
        for target in ("location", "area"):
            op.execute(f"ALTER TYPE public.travel_audit_target_type ADD VALUE IF NOT EXISTS '{target}'")


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
        "WHERE kind IN ('location.merge', 'area.merge') OR target_type IN ('location', 'area')"
    )
    _rebuild("travel_audit_event_kind", "kind", _KINDS)
    _rebuild("travel_audit_target_type", "target_type", _TARGETS)
