"""Independent, opt-in feed capabilities (#247)."""

import sqlalchemy as sa

from alembic import op

revision = "024_atom_feeds"
down_revision = "023_stay_documents"
branch_labels = None
depends_on = None
KINDS = ("feed.enable", "feed.rotate", "feed.revoke")


def upgrade() -> None:
    with op.get_context().autocommit_block():
        for kind in KINDS:
            op.execute(f"ALTER TYPE public.travel_audit_event_kind ADD VALUE IF NOT EXISTS '{kind}'")
    op.add_column("share_links", sa.Column("feed_token", sa.String(128), nullable=True))
    op.add_column("share_links", sa.Column("feed_verifier", sa.String(64), nullable=True))
    op.create_unique_constraint("uq_share_links_feed_verifier", "share_links", ["feed_verifier"])
    op.add_column("share_links", sa.Column("feed_expires_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    # PostgreSQL keeps unused enum labels; remove their audit rows before older code reads them.
    op.drop_column("share_links", "feed_expires_at")
    op.drop_constraint("uq_share_links_feed_verifier", "share_links", type_="unique")
    op.drop_column("share_links", "feed_verifier")
    op.drop_column("share_links", "feed_token")
    for kind in KINDS:
        op.execute(f"DELETE FROM public.audit_events WHERE kind = '{kind}'")
