import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from .database import Base


def opaque_id() -> str:
    return uuid.uuid4().hex


class Visibility(StrEnum):
    PRIVATE = "private"
    UNLISTED = "unlisted"
    PUBLIC = "public"


class PublicationState(StrEnum):
    DRAFT = "draft"
    PUBLISHED = "published"


class SurfaceState(StrEnum):
    UNPUBLISHED = "unpublished"
    PUBLISHED = "published"


class LinkState(StrEnum):
    DRAFT = "draft"
    ACTIVE = "active"
    REVOKED = "revoked"
    EXPIRED = "expired"


def _enum_column(enum_cls: type[StrEnum], name: str):
    return Enum(enum_cls, name=name, values_callable=lambda enum: [member.value for member in enum])


class Place(Base):
    __tablename__ = "places"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    country_code: Mapped[str | None] = mapped_column(String(2), nullable=True)


class Trip(Base):
    __tablename__ = "trips"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    owner_subject: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    visibility: Mapped[Visibility] = mapped_column(
        Enum(Visibility, name="travel_visibility", values_callable=lambda enum: [member.value for member in enum]),
        default=Visibility.PRIVATE,
    )
    publication_state: Mapped[PublicationState] = mapped_column(
        Enum(
            PublicationState,
            name="travel_publication_state",
            values_callable=lambda enum: [member.value for member in enum],
        ),
        default=PublicationState.DRAFT,
    )
    public_id: Mapped[str | None] = mapped_column(String(32), unique=True, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    route_stages: Mapped[list["RouteStage"]] = relationship(
        back_populates="trip", cascade="all, delete-orphan", order_by="RouteStage.position"
    )
    moments: Mapped[list["Moment"]] = relationship(
        back_populates="trip", cascade="all, delete-orphan", order_by="Moment.occurred_at"
    )


class RouteStage(Base):
    __tablename__ = "route_stages"
    __table_args__ = (UniqueConstraint("trip_id", "position", name="uq_route_stage_position"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    place_id: Mapped[str] = mapped_column(ForeignKey("places.id"), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    label: Mapped[str | None] = mapped_column(String(120), nullable=True)

    trip: Mapped[Trip] = relationship(back_populates="route_stages")
    place: Mapped[Place] = relationship()


class Moment(Base):
    __tablename__ = "moments"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    place_id: Mapped[str | None] = mapped_column(ForeignKey("places.id"), nullable=True)
    author_subject: Mapped[str] = mapped_column(String(255), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    story: Mapped[str] = mapped_column(Text, nullable=False)
    photo_urls: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    trip: Mapped[Trip] = relationship(back_populates="moments")
    place: Mapped[Place | None] = relationship()


class PublicSurface(Base):
    """The trip's public follower view: a stable URL, whether it's currently
    published, and its live scope. Content and scope both render from
    current canonical data on every request, filtered to `scope` — there is
    no frozen snapshot. `state` is the only gate: it controls whether this
    trip is served publicly at all; while published, editing `scope` takes
    effect immediately."""

    __tablename__ = "public_surfaces"

    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), primary_key=True)
    slug: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, default=opaque_id)
    state: Mapped[SurfaceState] = mapped_column(
        _enum_column(SurfaceState, "travel_surface_state"), default=SurfaceState.UNPUBLISHED
    )
    scope: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ShareLink(Base):
    """A named, revocable, high-entropy unlisted capability. Only a keyed
    verifier of the raw token is stored; the raw token is returned once, at
    activation or rotation, and never persisted. `state` gates whether the
    token works at all; while `active`, `scope` is live and editing it takes
    effect immediately for anyone holding the token — content and scope both
    render from current canonical data on every exchange, never a frozen
    snapshot."""

    __tablename__ = "share_links"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    state: Mapped[LinkState] = mapped_column(_enum_column(LinkState, "travel_link_state"), default=LinkState.DRAFT)
    scope: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    token_verifier: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
