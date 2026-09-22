"""Add owner-wide document library and emergency information.

Revision ID: 0014_owner_library
Revises: 0013_itinerary_tasks
Create Date: 2026-09-22
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0014_owner_library"
down_revision = "0013_itinerary_tasks"
branch_labels = None
depends_on = None


object_state = postgresql.ENUM(
    "staged", "available", "quarantined", "purge_pending", name="travel_object_state", create_type=False
)
document_kind = postgresql.ENUM("booking", "itinerary", "receipt", "other", name="travel_document_kind", create_type=False)
emergency_info_kind = postgresql.ENUM(
    "contact", "number", "medical_note", name="travel_emergency_info_kind", create_type=False
)


def upgrade() -> None:
    bind = op.get_bind()
    emergency_info_kind.create(bind, checkfirst=True)

    op.create_table(
        "owner_stored_objects",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("owner_subject", sa.String(length=255), nullable=False),
        sa.Column("bucket", sa.String(length=64), nullable=False),
        sa.Column("object_key", sa.String(length=255), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("content_type", sa.String(length=120), nullable=False),
        sa.Column("state", object_state, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("object_key"),
        sa.UniqueConstraint("owner_subject", "sha256", name="uq_owner_stored_object_owner_sha256"),
    )
    op.create_index("ix_owner_stored_objects_owner_subject", "owner_stored_objects", ["owner_subject"])

    op.create_table(
        "owner_documents",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("owner_subject", sa.String(length=255), nullable=False),
        sa.Column("original_object_id", sa.String(length=32), nullable=False),
        sa.Column("document_kind", document_kind, nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("owner_metadata", sa.JSON(), nullable=False),
        sa.Column("linked_trip_id", sa.String(length=32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["original_object_id"], ["owner_stored_objects.id"]),
        sa.ForeignKeyConstraint(["linked_trip_id"], ["trips.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("original_object_id"),
    )
    op.create_index("ix_owner_documents_owner_subject", "owner_documents", ["owner_subject"])
    op.create_index("ix_owner_documents_linked_trip_id", "owner_documents", ["linked_trip_id"])

    op.create_table(
        "emergency_info_entries",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("owner_subject", sa.String(length=255), nullable=False),
        sa.Column("kind", emergency_info_kind, nullable=False),
        sa.Column("label", sa.String(length=160), nullable=False),
        sa.Column("value", sa.String(length=255), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_emergency_info_entries_owner_subject", "emergency_info_entries", ["owner_subject"])


def downgrade() -> None:
    op.drop_index("ix_emergency_info_entries_owner_subject", table_name="emergency_info_entries")
    op.drop_table("emergency_info_entries")
    op.drop_index("ix_owner_documents_linked_trip_id", table_name="owner_documents")
    op.drop_index("ix_owner_documents_owner_subject", table_name="owner_documents")
    op.drop_table("owner_documents")
    op.drop_index("ix_owner_stored_objects_owner_subject", table_name="owner_stored_objects")
    op.drop_table("owner_stored_objects")
    emergency_info_kind.drop(op.get_bind(), checkfirst=True)
