"""Alternative group ORM models."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, String, false, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.base import _enum_column, opaque_id
from app.models.enums import AlternativeGroupKind

if TYPE_CHECKING:
    from app.models.routes import Route
    from app.models.stays import Stay
    from app.models.trips import Trip
    from app.models.visits import Visit


class AlternativeGroup(Base):
    """Owner-only: stays, visits or routes the owner is choosing between, and the one chosen.

    A group holds records of one ``kind`` and is private planning state: it is never part of a
    projection, a share, a file, navigation or a collection, and nothing a visitor receives
    mentions it. Existing ideas are not grouped automatically; the owner confirms a suggestion
    (``routers.alternatives``) or builds a group by hand. Choosing a member sets it to planned and
    the others to cancelled (or removes them) in one transaction with an audit event."""

    __tablename__ = "alternative_groups"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    kind: Mapped[AlternativeGroupKind] = mapped_column(
        _enum_column(AlternativeGroupKind, "travel_alternative_group_kind"), nullable=False
    )
    label: Mapped[str | None] = mapped_column(String(160), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    trip: Mapped[Trip] = relationship(back_populates="alternative_groups")
    members: Mapped[list[AlternativeGroupMember]] = relationship(
        back_populates="group", cascade="all, delete-orphan", order_by="AlternativeGroupMember.created_at"
    )


class AlternativeGroupMember(Base):
    """One stay, visit or route in an alternative group; a record is in at most one group.

    Exactly one of the three record columns is set, matching the group's ``kind``. ``chosen`` marks
    the member the owner picked; at most one member of a group is chosen."""

    __tablename__ = "alternative_group_members"
    __table_args__ = (
        CheckConstraint(
            "(CASE WHEN stay_id IS NULL THEN 0 ELSE 1 END) + (CASE WHEN visit_id IS NULL THEN 0 ELSE 1 END) "
            "+ (CASE WHEN route_id IS NULL THEN 0 ELSE 1 END) = 1",
            name="ck_alternative_member_one_record",
        ),
        Index(
            "uq_alternative_group_one_chosen",
            "group_id",
            unique=True,
            postgresql_where=text("chosen"),
            sqlite_where=text("chosen"),
        ),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    group_id: Mapped[str] = mapped_column(
        ForeignKey("alternative_groups.id", ondelete="CASCADE"), nullable=False, index=True
    )
    stay_id: Mapped[str | None] = mapped_column(ForeignKey("stays.id", ondelete="CASCADE"), nullable=True, unique=True)
    visit_id: Mapped[str | None] = mapped_column(
        ForeignKey("visits.id", ondelete="CASCADE"), nullable=True, unique=True
    )
    route_id: Mapped[str | None] = mapped_column(
        ForeignKey("routes.id", ondelete="CASCADE"), nullable=True, unique=True
    )
    chosen: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    group: Mapped[AlternativeGroup] = relationship(back_populates="members")
    stay: Mapped[Stay | None] = relationship(back_populates="alternative_membership")
    visit: Mapped[Visit | None] = relationship(back_populates="alternative_membership")
    route: Mapped[Route | None] = relationship(back_populates="alternative_membership")

    @property
    def record_id(self) -> str:
        return (self.stay_id or self.visit_id or self.route_id) or ""
