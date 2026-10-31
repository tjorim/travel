"""Record visitor-visible location edits in the sharing audit trail."""

from alembic import op

revision = "016_location_update_audit"
down_revision = "015_scope_revision"
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
)


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE public.travel_audit_event_kind ADD VALUE IF NOT EXISTS 'location.update'")


def downgrade() -> None:
    # PostgreSQL cannot drop an enum value, so recreate the type without it.
    op.execute("DELETE FROM public.audit_events WHERE kind = 'location.update'")
    listed = ", ".join(f"'{value}'" for value in _KINDS)
    op.execute("ALTER TYPE public.travel_audit_event_kind RENAME TO travel_audit_event_kind_old")
    op.execute(f"CREATE TYPE public.travel_audit_event_kind AS ENUM ({listed})")
    op.execute(
        "ALTER TABLE public.audit_events ALTER COLUMN kind "
        "TYPE public.travel_audit_event_kind USING kind::text::public.travel_audit_event_kind"
    )
    op.execute("DROP TYPE public.travel_audit_event_kind_old")
