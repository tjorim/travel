"""Add owner-managed document originals and reviewed redacted derivatives.

Revision ID: 0008_owner_managed_documents
Revises: 0007_recorded_tracks_and_broad_routes
Create Date: 2026-09-22
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0008_owner_managed_documents"
down_revision = "0007_recorded_tracks_routes"
branch_labels = None
depends_on = None

document_kind = postgresql.ENUM("booking", "itinerary", "receipt", "other", name="travel_document_kind", create_type=False)
derivative_review_state = postgresql.ENUM(
    "pending", "approved", name="travel_derivative_review_state", create_type=False
)


def upgrade() -> None:
    bind = op.get_bind()
    document_kind.create(bind, checkfirst=True)
    derivative_review_state.create(bind, checkfirst=True)

    op.create_table(
        "document_assets",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("trip_id", sa.String(length=32), nullable=False),
        sa.Column("original_object_id", sa.String(length=32), nullable=False),
        sa.Column("document_kind", document_kind, nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("owner_metadata", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["original_object_id"], ["stored_objects.id"]),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("original_object_id"),
    )
    op.create_index("ix_document_assets_trip_id", "document_assets", ["trip_id"])

    op.create_table(
        "document_derivatives",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("trip_id", sa.String(length=32), nullable=False),
        sa.Column("document_asset_id", sa.String(length=32), nullable=False),
        sa.Column("object_id", sa.String(length=32), nullable=False),
        sa.Column("redaction_manifest_object_id", sa.String(length=32), nullable=False),
        sa.Column("review_state", derivative_review_state, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["document_asset_id"], ["document_assets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["object_id"], ["stored_objects.id"]),
        sa.ForeignKeyConstraint(["redaction_manifest_object_id"], ["stored_objects.id"]),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("object_id"),
        sa.UniqueConstraint("redaction_manifest_object_id"),
    )
    op.create_index("ix_document_derivatives_trip_id", "document_derivatives", ["trip_id"])
    op.create_index("ix_document_derivatives_document_asset_id", "document_derivatives", ["document_asset_id"])


def downgrade() -> None:
    op.drop_index("ix_document_derivatives_document_asset_id", table_name="document_derivatives")
    op.drop_index("ix_document_derivatives_trip_id", table_name="document_derivatives")
    op.drop_table("document_derivatives")
    op.drop_index("ix_document_assets_trip_id", table_name="document_assets")
    op.drop_table("document_assets")
    document_kind.drop(op.get_bind(), checkfirst=True)
