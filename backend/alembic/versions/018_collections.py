"""Add owner-wide collection links that open several trips at once."""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "018_collections"
down_revision = "017_trip_object_cleanup"
branch_labels = None
depends_on = None


def upgrade() -> None:
    link_state = postgresql.ENUM(name="travel_link_state", schema="public", create_type=False)
    op.create_table(
        "collections",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("owner_subject", sa.String(255), nullable=False),
        sa.Column("label", sa.String(120), nullable=False),
        sa.Column("title", sa.String(160), nullable=True),
        sa.Column("state", link_state, nullable=False),
        sa.Column("token", sa.String(128), nullable=True),
        sa.Column("token_verifier", sa.String(64), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rotations", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("token_verifier", name="collections_token_verifier_key"),
    )
    op.create_index("ix_collections_owner_subject", "collections", ["owner_subject"])
    op.create_table(
        "collection_members",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("collection_id", sa.String(32), sa.ForeignKey("collections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("trip_id", sa.String(32), sa.ForeignKey("trips.id", ondelete="CASCADE"), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("scope", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("collection_id", "trip_id", name="uq_collection_members_trip"),
    )
    op.create_index("ix_collection_members_collection_id", "collection_members", ["collection_id"])
    op.create_index("ix_collection_members_trip_id", "collection_members", ["trip_id"])
    op.create_table(
        "collection_audit_events",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("owner_subject", sa.String(255), nullable=False),
        sa.Column("actor_subject", sa.String(255), nullable=False),
        sa.Column("collection_id", sa.String(32), nullable=False),
        sa.Column("trip_id", sa.String(32), nullable=True),
        sa.Column("kind", sa.String(60), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("details", sa.JSON(), nullable=False),
    )
    op.create_index("ix_collection_audit_events_owner_subject", "collection_audit_events", ["owner_subject"])
    op.create_index("ix_collection_audit_events_collection_id", "collection_audit_events", ["collection_id"])


def downgrade() -> None:
    # The shared travel_link_state type stays: share_links still uses it.
    op.drop_table("collection_audit_events")
    op.drop_table("collection_members")
    op.drop_table("collections")
