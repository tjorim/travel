"""Add private alternative groups: the stays, visits or routes an owner is choosing between.

A group belongs to one trip, has one ``kind`` and holds members that each point at one stay, visit
or route (a record is in at most one group). One member may be ``chosen``. Existing ideas are not
grouped by this migration: the application suggests groups from matching dates and the owner
confirms them.

Choosing and undoing a choice are recorded as audit events, so two values are added to the audit
event and target types. PostgreSQL cannot drop an enum value: the downgrade deletes the audit rows
that use them and leaves the unused values in the types.
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "021_alternative_groups"
down_revision = "020_area_only_stay"
branch_labels = None
depends_on = None

_KINDS = ("alternative_group.choose", "alternative_group.undo_choice")
_TARGET = "alternative_group"


def upgrade() -> None:
    with op.get_context().autocommit_block():
        for kind in _KINDS:
            op.execute(f"ALTER TYPE public.travel_audit_event_kind ADD VALUE IF NOT EXISTS '{kind}'")
        op.execute(f"ALTER TYPE public.travel_audit_target_type ADD VALUE IF NOT EXISTS '{_TARGET}'")
    group_kind = postgresql.ENUM("stay", "visit", "route", name="travel_alternative_group_kind", schema="public")
    op.create_table(
        "alternative_groups",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("trip_id", sa.String(32), sa.ForeignKey("trips.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", group_kind, nullable=False),
        sa.Column("label", sa.String(160), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_alternative_groups_trip_id", "alternative_groups", ["trip_id"])
    op.create_table(
        "alternative_group_members",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column(
            "group_id", sa.String(32), sa.ForeignKey("alternative_groups.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("stay_id", sa.String(32), sa.ForeignKey("stays.id", ondelete="CASCADE"), nullable=True),
        sa.Column("visit_id", sa.String(32), sa.ForeignKey("visits.id", ondelete="CASCADE"), nullable=True),
        sa.Column("route_id", sa.String(32), sa.ForeignKey("routes.id", ondelete="CASCADE"), nullable=True),
        sa.Column("chosen", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "(CASE WHEN stay_id IS NULL THEN 0 ELSE 1 END) + (CASE WHEN visit_id IS NULL THEN 0 ELSE 1 END) "
            "+ (CASE WHEN route_id IS NULL THEN 0 ELSE 1 END) = 1",
            name="ck_alternative_member_one_record",
        ),
        sa.UniqueConstraint("stay_id", name="alternative_group_members_stay_id_key"),
        sa.UniqueConstraint("visit_id", name="alternative_group_members_visit_id_key"),
        sa.UniqueConstraint("route_id", name="alternative_group_members_route_id_key"),
    )
    op.create_index("ix_alternative_group_members_group_id", "alternative_group_members", ["group_id"])
    op.create_index(
        "uq_alternative_group_one_chosen",
        "alternative_group_members",
        ["group_id"],
        unique=True,
        postgresql_where=sa.text("chosen"),
    )


def downgrade() -> None:
    op.drop_table("alternative_group_members")
    op.drop_table("alternative_groups")
    op.execute("DROP TYPE public.travel_alternative_group_kind")
    op.execute(
        "DELETE FROM public.audit_events WHERE kind IN ('alternative_group.choose', 'alternative_group.undo_choice')"
    )
