"""Add media ingestion tables: object storage inventory, import sessions and
records, media assets and derivatives.

Revision ID: 0003_media_ingestion
Revises: 0002_publication_and_share_links
Create Date: 2026-09-22
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0003_media_ingestion"
down_revision = "0002_publication_and_share_links"
branch_labels = None
depends_on = None


object_state = postgresql.ENUM(
    "staged", "available", "quarantined", "purge_pending", name="travel_object_state", create_type=False
)
import_provider = postgresql.ENUM(
    "direct_device", "google_photos_picker", "gopro_cloud", name="travel_import_provider", create_type=False
)
import_session_state = postgresql.ENUM(
    "pending", "completed", "expired", name="travel_import_session_state", create_type=False
)
import_state = postgresql.ENUM("pending", "completed", "failed", name="travel_import_state", create_type=False)
media_kind = postgresql.ENUM("photo", "video", name="travel_media_kind", create_type=False)
derivative_purpose = postgresql.ENUM(
    "owner_preview", "share", "static_export", name="travel_derivative_purpose", create_type=False
)
derivative_review_state = postgresql.ENUM(
    "pending", "approved", name="travel_derivative_review_state", create_type=False
)


def upgrade() -> None:
    bind = op.get_bind()
    object_state.create(bind, checkfirst=True)
    import_provider.create(bind, checkfirst=True)
    import_session_state.create(bind, checkfirst=True)
    import_state.create(bind, checkfirst=True)
    media_kind.create(bind, checkfirst=True)
    derivative_purpose.create(bind, checkfirst=True)
    derivative_review_state.create(bind, checkfirst=True)

    op.create_table(
        "stored_objects",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("trip_id", sa.String(length=32), nullable=False),
        sa.Column("bucket", sa.String(length=64), nullable=False),
        sa.Column("object_key", sa.String(length=255), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("content_type", sa.String(length=120), nullable=False),
        sa.Column("state", object_state, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("object_key"),
        sa.UniqueConstraint("trip_id", "sha256", name="uq_stored_object_trip_sha256"),
    )
    op.create_index("ix_stored_objects_trip_id", "stored_objects", ["trip_id"])

    op.create_table(
        "import_sessions",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("trip_id", sa.String(length=32), nullable=False),
        sa.Column("provider", import_provider, nullable=False),
        sa.Column("provider_session_id", sa.String(length=255), nullable=False),
        sa.Column("state", import_session_state, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_import_sessions_trip_id", "import_sessions", ["trip_id"])

    op.create_table(
        "import_records",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("trip_id", sa.String(length=32), nullable=False),
        sa.Column("provider", import_provider, nullable=False),
        sa.Column("provider_item_id", sa.String(length=255), nullable=False),
        sa.Column("state", import_state, nullable=False),
        sa.Column("media_asset_id", sa.String(length=32), nullable=True),
        sa.Column("requested_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failure_code", sa.String(length=120), nullable=True),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("trip_id", "provider", "provider_item_id", name="uq_import_record_provider_item"),
    )
    op.create_index("ix_import_records_trip_id", "import_records", ["trip_id"])

    op.create_table(
        "media_assets",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("trip_id", sa.String(length=32), nullable=False),
        sa.Column("original_object_id", sa.String(length=32), nullable=False),
        sa.Column("media_kind", media_kind, nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("import_id", sa.String(length=32), nullable=True),
        sa.Column("raw_metadata", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["original_object_id"], ["stored_objects.id"]),
        sa.ForeignKeyConstraint(["import_id"], ["import_records.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("original_object_id"),
    )
    op.create_index("ix_media_assets_trip_id", "media_assets", ["trip_id"])
    op.create_foreign_key(
        "fk_import_records_media_asset_id",
        "import_records",
        "media_assets",
        ["media_asset_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.create_table(
        "media_derivatives",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("trip_id", sa.String(length=32), nullable=False),
        sa.Column("media_asset_id", sa.String(length=32), nullable=False),
        sa.Column("object_id", sa.String(length=32), nullable=False),
        sa.Column("purpose", derivative_purpose, nullable=False),
        sa.Column("metadata_stripped_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_state", derivative_review_state, nullable=False),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["media_asset_id"], ["media_assets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["object_id"], ["stored_objects.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("object_id"),
    )
    op.create_index("ix_media_derivatives_trip_id", "media_derivatives", ["trip_id"])
    op.create_index("ix_media_derivatives_media_asset_id", "media_derivatives", ["media_asset_id"])


def downgrade() -> None:
    op.drop_index("ix_media_derivatives_media_asset_id", table_name="media_derivatives")
    op.drop_index("ix_media_derivatives_trip_id", table_name="media_derivatives")
    op.drop_table("media_derivatives")

    op.drop_constraint("fk_import_records_media_asset_id", "import_records", type_="foreignkey")
    op.drop_index("ix_media_assets_trip_id", table_name="media_assets")
    op.drop_table("media_assets")

    op.drop_index("ix_import_records_trip_id", table_name="import_records")
    op.drop_table("import_records")

    op.drop_index("ix_import_sessions_trip_id", table_name="import_sessions")
    op.drop_table("import_sessions")

    op.drop_index("ix_stored_objects_trip_id", table_name="stored_objects")
    op.drop_table("stored_objects")

    derivative_review_state.drop(op.get_bind(), checkfirst=True)
    derivative_purpose.drop(op.get_bind(), checkfirst=True)
    media_kind.drop(op.get_bind(), checkfirst=True)
    import_state.drop(op.get_bind(), checkfirst=True)
    import_session_state.drop(op.get_bind(), checkfirst=True)
    import_provider.drop(op.get_bind(), checkfirst=True)
    object_state.drop(op.get_bind(), checkfirst=True)
