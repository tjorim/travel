"""Remember which sharing preset was last applied to an audience (#241).

``applied_preset`` and ``applied_preset_at`` are nullable on the public view, the hidden links and the collection
members. They are a display label only: what an audience receives is still decided by the record visibilities and the
scope, so no existing row changes what it delivers (every row starts ``NULL``) and an older application that ignores
the columns delivers exactly the same.

Applying a preset is recorded as an audit event, so one value is added to the audit event type. PostgreSQL cannot drop
an enum value: the downgrade deletes the audit rows that use it and leaves the unused value in the type.
"""

import sqlalchemy as sa

from alembic import op

revision = "022_sharing_preset_label"
down_revision = "021_alternative_groups"
branch_labels = None
depends_on = None

_KIND = "audience.preset_apply"
_TABLES = ("public_surfaces", "share_links", "collection_members")


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(f"ALTER TYPE public.travel_audit_event_kind ADD VALUE IF NOT EXISTS '{_KIND}'")
    for table in _TABLES:
        op.add_column(table, sa.Column("applied_preset", sa.String(32), nullable=True))
        op.add_column(table, sa.Column("applied_preset_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    for table in reversed(_TABLES):
        op.drop_column(table, "applied_preset_at")
        op.drop_column(table, "applied_preset")
    op.execute(f"DELETE FROM public.audit_events WHERE kind = '{_KIND}'")
    # Collection events use free-text kinds, so the member apply of a newer application is simply removed.
    op.execute("DELETE FROM public.collection_audit_events WHERE kind = 'collection.member_preset_apply'")
