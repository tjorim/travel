"""Add owner-only stays and separately authored broad stay cards.

Revision ID: 0006_stays_and_broad_stay_cards
Revises: 0005_split_places_and_excerpts
Create Date: 2026-09-22
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0006_stays_and_broad_stay_cards"
down_revision = "0005_split_places_and_excerpts"
branch_labels = None
depends_on = None


stay_status = postgresql.ENUM(
    "planned", "booked", "confirmed", "cancelled", name="travel_stay_status", create_type=False
)
date_precision = postgresql.ENUM("day", "month", "year", name="travel_date_precision", create_type=False)


def upgrade() -> None:
    stay_status.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "stays",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("trip_id", sa.String(length=32), nullable=False),
        sa.Column("exact_place_id", sa.String(length=32), nullable=False),
        sa.Column("arrives_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("departs_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", stay_status, nullable=False),
        sa.Column("property_name", sa.String(length=160), nullable=False),
        sa.Column("booking_reference", sa.String(length=255), nullable=True),
        sa.Column("contact_details", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("departs_at > arrives_at", name="ck_stay_departure_after_arrival"),
        sa.ForeignKeyConstraint(["exact_place_id"], ["places.id"]),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_stays_trip_id", "stays", ["trip_id"])

    op.create_table(
        "broad_stay_cards",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("trip_id", sa.String(length=32), nullable=False),
        sa.Column("broad_place_id", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("date_precision", date_precision, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["broad_place_id"], ["places.id"]),
        sa.ForeignKeyConstraint(["trip_id"], ["trips.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_broad_stay_cards_trip_id", "broad_stay_cards", ["trip_id"])


def downgrade() -> None:
    op.drop_index("ix_broad_stay_cards_trip_id", table_name="broad_stay_cards")
    op.drop_table("broad_stay_cards")
    op.drop_index("ix_stays_trip_id", table_name="stays")
    op.drop_table("stays")
    stay_status.drop(op.get_bind(), checkfirst=True)
