"""Add owner-only transport itinerary legs and document attachments.

Revision ID: 0012_transport_legs
Revises: 0011_moment_media_attachments
Create Date: 2026-09-22
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0012_transport_legs"
down_revision = "0011_moment_media_attachments"
branch_labels = None
depends_on = None


transport_leg_kind = postgresql.ENUM(
    "flight", "train", "bus", "ferry", "car", "other", name="travel_transport_leg_kind", create_type=False
)
transport_leg_status = postgresql.ENUM(
    "planned", "booked", "confirmed", "cancelled", name="travel_transport_leg_status", create_type=False
)


def upgrade() -> None:
    bind = op.get_bind()
    transport_leg_kind.create(bind, checkfirst=True)
    transport_leg_status.create(bind, checkfirst=True)

    op.create_table(
        "transport_legs",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("trip_id", sa.String(length=32), nullable=False),
        sa.Column("kind", transport_leg_kind, nullable=False),
        sa.Column("status", transport_leg_status, nullable=False),
        sa.Column("departure_place_id", sa.String(length=32), nullable=False),
        sa.Column("arrival_place_id", sa.String(length=32), nullable=False),
        sa.Column("departs_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("arrives_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("carrier", sa.String(length=160), nullable=True),
        sa.Column("service_reference", sa.String(length=40), nullable=True),
        sa.Column("booking_reference", sa.String(length=255), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("arrives_at > departs_at", name="ck_transport_leg_arrival_after_departure"),
        sa.ForeignKeyConstraint(["departure_place_id"], ["places.id"]),
        sa.ForeignKeyConstraint(["arrival_place_id"], ["places.id"]),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_transport_legs_trip_id", "transport_legs", ["trip_id"])

    op.create_table(
        "transport_leg_document_assets",
        sa.Column("transport_leg_id", sa.String(length=32), nullable=False),
        sa.Column("document_asset_id", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["transport_leg_id"], ["transport_legs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["document_asset_id"], ["document_assets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("transport_leg_id", "document_asset_id"),
    )
    op.create_index(
        "ix_transport_leg_document_assets_document_asset_id",
        "transport_leg_document_assets",
        ["document_asset_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_transport_leg_document_assets_document_asset_id", table_name="transport_leg_document_assets")
    op.drop_table("transport_leg_document_assets")
    op.drop_index("ix_transport_legs_trip_id", table_name="transport_legs")
    op.drop_table("transport_legs")
    transport_leg_status.drop(op.get_bind(), checkfirst=True)
    transport_leg_kind.drop(op.get_bind(), checkfirst=True)
