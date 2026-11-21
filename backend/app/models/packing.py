"""Packing list, template, bag and item ORM models."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.db.base import Base
from app.models.base import opaque_id

if TYPE_CHECKING:
    from app.models.trips import Trip


class PackingList(Base):
    __tablename__ = "packing_lists"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    trip: Mapped[Trip] = relationship(back_populates="packing_lists")
    bags: Mapped[list[PackingBag]] = relationship(back_populates="packing_list", cascade="all, delete-orphan")
    items: Mapped[list[PackingItem]] = relationship(back_populates="packing_list", cascade="all, delete-orphan")


class PackingTemplate(Base):
    __tablename__ = "packing_templates"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    owner_subject: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    snapshot: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PackingBag(Base):
    __tablename__ = "packing_bags"
    __table_args__ = (
        CheckConstraint("weight_limit_g IS NULL OR weight_limit_g > 0", name="ck_packing_bag_weight_limit"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    list_id: Mapped[str] = mapped_column(ForeignKey("packing_lists.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    weight_limit_g: Mapped[int | None] = mapped_column(Integer, nullable=True)
    packing_list: Mapped[PackingList] = relationship(back_populates="bags")


class PackingItem(Base):
    __tablename__ = "packing_items"
    __table_args__ = (
        CheckConstraint("quantity BETWEEN 1 AND 99", name="ck_packing_item_quantity"),
        CheckConstraint("weight_g IS NULL OR weight_g >= 0", name="ck_packing_item_weight"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    list_id: Mapped[str] = mapped_column(ForeignKey("packing_lists.id", ondelete="CASCADE"), nullable=False, index=True)
    bag_id: Mapped[str | None] = mapped_column(
        ForeignKey("packing_bags.id", ondelete="SET NULL"), nullable=True, index=True
    )
    label: Mapped[str] = mapped_column(String(160), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    category: Mapped[str | None] = mapped_column(String(80), nullable=True)
    packed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    essential: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_minute: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    valuable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    cabin_only: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    checked_only: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    weight_g: Mapped[int | None] = mapped_column(Integer, nullable=True)
    packing_list: Mapped[PackingList] = relationship(back_populates="items")
