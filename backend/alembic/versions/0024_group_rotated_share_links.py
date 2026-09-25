"""Group rotated share links into one owner-visible history.

Rotation already recorded each replacement link's predecessor in the audit
trail. Reuse that audit data to give existing rotations the same stable series
identifier as newly created links.

Revision ID: 0024_group_share_links
Revises: 0023_owner_share_tokens
Create Date: 2026-09-25
"""

import sqlalchemy as sa

from alembic import op

revision = "0024_group_share_links"
down_revision = "0023_owner_share_tokens"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("share_links", sa.Column("series_id", sa.String(length=32), nullable=True))
    bind = op.get_bind()
    links = sa.table("share_links", sa.column("id", sa.String), sa.column("series_id", sa.String))
    events = sa.table(
        "audit_events",
        sa.column("target_id", sa.String),
        sa.column("kind", sa.String),
        sa.column("details", sa.JSON),
        sa.column("occurred_at", sa.DateTime),
    )

    # Every standalone link starts its own series.
    for (link_id,) in bind.execute(sa.select(links.c.id)):
        bind.execute(sa.update(links).where(links.c.id == link_id).values(series_id=link_id))

    # Then join every historical replacement to its predecessor's series.
    rotated = bind.execute(
        sa.select(events.c.target_id, events.c.details)
        .where(sa.cast(events.c.kind, sa.String) == "share_link.rotate")
        .order_by(events.c.occurred_at, events.c.target_id)
    )
    for link_id, details in rotated:
        predecessor_id = details.get("predecessor_id") if isinstance(details, dict) else None
        if not isinstance(predecessor_id, str):
            continue
        series_id = bind.execute(sa.select(links.c.series_id).where(links.c.id == predecessor_id)).scalar_one_or_none()
        if series_id is not None:
            bind.execute(sa.update(links).where(links.c.id == link_id).values(series_id=series_id))

    op.alter_column("share_links", "series_id", nullable=False)
    op.create_index("ix_share_links_series_id", "share_links", ["series_id"])


def downgrade() -> None:
    op.drop_index("ix_share_links_series_id", table_name="share_links")
    op.drop_column("share_links", "series_id")
