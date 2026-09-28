"""Add owner-only packing lists, bags and items.

Revision ID: 006_packing
Revises: 005_route_departure_day
"""

import sqlalchemy as sa

from alembic import op

revision = "006_packing"
down_revision = "005_route_departure_day"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "packing_lists",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("trip_id", sa.String(32), sa.ForeignKey("trips.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_packing_lists_trip_id", "packing_lists", ["trip_id"])
    op.create_table(
        "packing_bags",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("list_id", sa.String(32), sa.ForeignKey("packing_lists.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("type", sa.String(80)),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("weight_limit_g", sa.Integer()),
        sa.CheckConstraint("weight_limit_g IS NULL OR weight_limit_g > 0", name="ck_packing_bag_weight_limit"),
    )
    op.create_index("ix_packing_bags_list_id", "packing_bags", ["list_id"])
    op.create_table(
        "packing_items",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("list_id", sa.String(32), sa.ForeignKey("packing_lists.id", ondelete="CASCADE"), nullable=False),
        sa.Column("bag_id", sa.String(32), sa.ForeignKey("packing_bags.id", ondelete="SET NULL")),
        sa.Column("label", sa.String(160), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("category", sa.String(80)),
        sa.Column("packed", sa.Boolean(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("essential", sa.Boolean(), nullable=False),
        sa.Column("valuable", sa.Boolean(), nullable=False),
        sa.Column("cabin_only", sa.Boolean(), nullable=False),
        sa.Column("checked_only", sa.Boolean(), nullable=False),
        sa.Column("notes", sa.Text()),
        sa.Column("weight_g", sa.Integer()),
        sa.CheckConstraint("quantity BETWEEN 1 AND 99", name="ck_packing_item_quantity"),
        sa.CheckConstraint("weight_g IS NULL OR weight_g >= 0", name="ck_packing_item_weight"),
    )
    op.create_index("ix_packing_items_list_id", "packing_items", ["list_id"])
    op.create_index("ix_packing_items_bag_id", "packing_items", ["bag_id"])


def downgrade() -> None:
    op.drop_table("packing_items")
    op.drop_table("packing_bags")
    op.drop_table("packing_lists")
