import uuid
from datetime import date, datetime, time
from enum import StrEnum

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
    false,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from .database import Base


def opaque_id() -> str:
    return uuid.uuid4().hex


# SQLAlchemy Integer is a signed 32-bit column on PostgreSQL.
INTEGER_MAX = 2**31 - 1


class SurfaceState(StrEnum):
    UNPUBLISHED = "unpublished"
    PUBLISHED = "published"


class LinkState(StrEnum):
    DRAFT = "draft"
    ACTIVE = "active"
    REVOKED = "revoked"
    EXPIRED = "expired"


class ObjectState(StrEnum):
    STAGED = "staged"
    AVAILABLE = "available"
    QUARANTINED = "quarantined"
    PURGE_PENDING = "purge_pending"


class MediaKind(StrEnum):
    PHOTO = "photo"
    VIDEO = "video"


class DocumentKind(StrEnum):
    BOOKING = "booking"
    ITINERARY = "itinerary"
    RECEIPT = "receipt"
    OTHER = "other"


class EmergencyInfoKind(StrEnum):
    CONTACT = "contact"
    NUMBER = "number"
    MEDICAL_NOTE = "medical_note"


class ImportProvider(StrEnum):
    DIRECT_DEVICE = "direct_device"
    GOOGLE_PHOTOS_PICKER = "google_photos_picker"
    GOPRO_CLOUD = "gopro_cloud"


class ProviderSecret(Base):
    __tablename__ = "provider_secrets"

    subject: Mapped[str] = mapped_column(String(255), primary_key=True)
    provider: Mapped[str] = mapped_column(String(64), primary_key=True)
    kind: Mapped[str] = mapped_column(String(32), primary_key=True)
    ciphertext: Mapped[str] = mapped_column(Text, nullable=False)


class ImportSessionState(StrEnum):
    PENDING = "pending"
    COMPLETED = "completed"
    EXPIRED = "expired"


class ImportState(StrEnum):
    PENDING = "pending"
    COMPLETED = "completed"
    FAILED = "failed"


class DerivativePurpose(StrEnum):
    OWNER_PREVIEW = "owner_preview"
    SHARE = "share"
    STATIC_EXPORT = "static_export"


class DerivativeReviewState(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"


class DerivativeProcessingState(StrEnum):
    PROCESSING = "processing"
    FAILED = "failed"
    READY = "ready"


class DatePrecision(StrEnum):
    DAY = "day"
    MONTH = "month"
    YEAR = "year"


class StayStatus(StrEnum):
    IDEA = "idea"
    PLANNED = "planned"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"


class RouteMode(StrEnum):
    """How a route is travelled."""

    FLIGHT = "flight"
    TRAIN = "train"
    BUS = "bus"
    FERRY = "ferry"
    CAR = "car"
    BIKE = "bike"
    WALK = "walk"
    OTHER = "other"


class RouteStatus(StrEnum):
    IDEA = "idea"
    PLANNED = "planned"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"


class Visibility(StrEnum):
    """Who receives a shareable record: nobody, every audience, or only the
    audiences whose scope selects it. It is the source of truth for that
    record, and the same three choices apply to every kind of record that can
    be shared."""

    PRIVATE = "private"
    EVERYONE = "everyone"
    CUSTOM = "custom"


class VisitKind(StrEnum):
    """What kind of days a visit is: free days, or working ones."""

    FREE = "free"
    WORK = "work"


class VisitStatus(StrEnum):
    """How settled a visit is: an idea, planned, confirmed, or cancelled (dropped).

    Owner-only planning state, kept here instead of in a title or area label
    (which visitors see). It is never shared. Areas carry no status of their
    own: an area is as settled as the visits in it."""

    IDEA = "idea"
    PLANNED = "planned"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"


class AuditEventKind(StrEnum):
    PUBLIC_PROJECTION_PUBLISH = "public_projection.publish"
    PUBLIC_PROJECTION_UNPUBLISH = "public_projection.unpublish"
    SHARE_LINK_CREATE = "share_link.create"
    SHARE_LINK_ACTIVATE = "share_link.activate"
    SHARE_LINK_REVOKE = "share_link.revoke"
    SHARE_LINK_ROTATE = "share_link.rotate"
    SHARE_LINK_EXPIRE = "share_link.expire"
    # Merging duplicate locations or areas can narrow what an audience
    # receives, so it is recorded with the other audience-affecting changes.
    LOCATION_MERGE = "location.merge"
    AREA_MERGE = "area.merge"
    # Editing the visitor-facing text or area of a shared location reaches its live audiences at once.
    LOCATION_UPDATE = "location.update"
    # Live scope and record-audience edits change what visitors receive at once.
    PUBLIC_PROJECTION_SCOPE_CHANGE = "public_projection.scope_change"
    SHARE_LINK_SCOPE_CHANGE = "share_link.scope_change"
    VISIBILITY_CHANGE = "record.visibility_change"
    # Letting visits and stays follow the audience's date precision can show visitors finer dates at once.
    PRECISION_FOLLOW_AUDIENCE = "record.precision_follow_audience"
    # Choosing one alternative of a group changes the status of its members at once, and can be undone.
    ALTERNATIVE_CHOOSE = "alternative_group.choose"
    ALTERNATIVE_UNDO_CHOICE = "alternative_group.undo_choice"
    # Applying a sharing preset rewrites one audience's scope and the visibility of the records it lists at once (#241).
    AUDIENCE_PRESET_APPLY = "audience.preset_apply"


class AuditTargetType(StrEnum):
    PUBLIC_SURFACE = "public_surface"
    SHARE_LINK = "share_link"
    LOCATION = "location"
    AREA = "area"
    RECORD = "record"
    ALTERNATIVE_GROUP = "alternative_group"


class AlternativeGroupKind(StrEnum):
    """What an alternative group compares: all of its members are of this one kind."""

    STAY = "stay"
    VISIT = "visit"
    ROUTE = "route"


def _enum_column(enum_cls: type[StrEnum], name: str):
    return Enum(enum_cls, name=name, values_callable=lambda enum: [member.value for member in enum])


def _visibility_column():
    """A record's audience choice; ``private`` until the owner decides."""
    return mapped_column(_enum_column(Visibility, "travel_visibility"), default=Visibility.PRIVATE, nullable=False)


class Area(Base):
    """A city or region: where things are, without saying exactly where.

    An area holds a label, country and region, an optional rounded point and an
    optional IANA time zone (for example ``Asia/Taipei``), which lets the
    owner's views place stays and live local time. Sharing an area shows its
    label, region, country and point, never its time zone, and never shares the
    locations filed under it."""

    __tablename__ = "areas"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    visibility: Mapped[Visibility] = _visibility_column()
    # ``None`` marks an unnamed area: the owner gave no name, so the interface
    # shows its own translated fallback and nothing language-bound is stored.
    label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    region: Mapped[str | None] = mapped_column(String(120), nullable=True)
    country_code: Mapped[str | None] = mapped_column(String(2), nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    timezone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Location(Base):
    """A hotel, station or monument, with an address and coordinates, or just a city.

    A location always belongs to one ``area``. It can be shared by its
    ``visibility``, but only through a fixed allowlist: its public ``label``,
    city, country and point, and its address only when the owner has also
    chosen ``share_address``. Notes, provider ids and the display name (which
    usually contains the address) are never shared, and a location cannot be
    shared without a ``label``."""

    __tablename__ = "locations"
    __table_args__ = (
        Index("ix_locations_osm_element", "osm_element_type", "osm_element_id"),
        CheckConstraint(
            "(osm_element_type IS NULL) = (osm_element_id IS NULL)", name="ck_locations_osm_reference_pair"
        ),
        CheckConstraint(
            "osm_element_type IS NULL OR osm_element_type IN ('node', 'way', 'relation')",
            name="ck_locations_osm_element_type",
        ),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    # Derived from the location's city when it is created, and changeable.
    area_id: Mapped[str] = mapped_column(ForeignKey("areas.id"), nullable=False, index=True)
    visibility: Mapped[Visibility] = _visibility_column()
    # The name a shared location goes by: owner-only until the location is shared,
    # and required for that, because the display name usually contains the address.
    label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # Whether a shared location also shows its address, for example a hotel family
    # may need to contact. A separate choice from sharing the location at all.
    share_address: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # An OSM element is durable as the (type, id) pair.  In particular,
    # Nominatim's result-local ``place_id`` is intentionally not stored.
    osm_element_type: Mapped[str | None] = mapped_column(String(12), nullable=True)
    osm_element_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    osm_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(500), nullable=True)
    address_line1: Mapped[str | None] = mapped_column(String(160), nullable=True)
    address_line2: Mapped[str | None] = mapped_column(String(160), nullable=True)
    locality: Mapped[str | None] = mapped_column(String(120), nullable=True)
    admin_area: Mapped[str | None] = mapped_column(String(120), nullable=True)
    postal_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    country_code: Mapped[str | None] = mapped_column(String(2), nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    viewport_north: Mapped[float | None] = mapped_column(Float, nullable=True)
    viewport_south: Mapped[float | None] = mapped_column(Float, nullable=True)
    viewport_east: Mapped[float | None] = mapped_column(Float, nullable=True)
    viewport_west: Mapped[float | None] = mapped_column(Float, nullable=True)
    navigation_provider: Mapped[str | None] = mapped_column(String(40), nullable=True)
    navigation_provider_place_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    area: Mapped[Area] = relationship(foreign_keys=[area_id])


class Trip(Base):
    __tablename__ = "trips"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    owner_subject: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Local calendar dates of the first and last travel day. Owner-only
    # unless a share scope explicitly selects them at a chosen precision.
    starts_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    ends_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    visits: Mapped[list[Visit]] = relationship(
        back_populates="trip", cascade="all, delete-orphan", order_by="Visit.position"
    )
    areas: Mapped[list[Area]] = relationship(
        foreign_keys="Area.trip_id", cascade="all, delete-orphan", order_by="Area.created_at"
    )
    locations: Mapped[list[Location]] = relationship(
        foreign_keys="Location.trip_id", cascade="all, delete-orphan", order_by="Location.created_at"
    )
    travel_updates: Mapped[list[TravelUpdate]] = relationship(
        back_populates="trip", cascade="all, delete-orphan", order_by="TravelUpdate.occurred_at"
    )
    stays: Mapped[list[Stay]] = relationship(
        back_populates="trip", cascade="all, delete-orphan", order_by="Stay.check_in_date"
    )
    trip_tasks: Mapped[list[TripTask]] = relationship(
        back_populates="trip", cascade="all, delete-orphan", order_by="TripTask.created_at"
    )
    packing_lists: Mapped[list[PackingList]] = relationship(back_populates="trip", cascade="all, delete-orphan")
    routes: Mapped[list[Route]] = relationship(
        back_populates="trip",
        cascade="all, delete-orphan",
        # By day; within a day, day-only routes follow the timed ones, as in the Agenda.
        order_by=lambda: (
            Route.departs_on.is_(None),
            Route.departs_on,
            Route.departs_at.is_(None),
            Route.departs_at,
            Route.created_at,
        ),
    )
    media_derivatives: Mapped[list[MediaDerivative]] = relationship(
        back_populates="trip", cascade="all, delete-orphan", order_by="MediaDerivative.created_at"
    )
    alternative_groups: Mapped[list[AlternativeGroup]] = relationship(
        back_populates="trip", cascade="all, delete-orphan", order_by="AlternativeGroup.created_at"
    )

    # A deleted trip leaves every collection in the same transaction.
    collection_memberships: Mapped[list[CollectionMember]] = relationship(cascade="all, delete-orphan")

    @property
    def cover_derivative_id(self) -> str | None:
        """The photo copy the owner nominated as cover; ``None`` when there is none or it was deleted."""
        return next((item.id for item in self.media_derivatives if item.is_cover), None)

    @property
    def cover_url(self) -> str | None:
        """The owner-only file route of the cover copy; a visitor's cover comes from the audience's projection."""
        cover = next((item for item in self.media_derivatives if item.is_cover), None)
        if cover is None:
            return None
        return f"/api/trips/{self.id}/media/{cover.media_asset_id}/derivatives/{cover.id}/file"


class TravelUpdateMediaAsset(Base):
    """An owner-only, explicit attachment of an ingested asset to a reisupdate.

    This is deliberately separate from a share derivative. Attaching an
    original gives the owner a private editing affordance; it never makes the
    asset or its EXIF eligible for projection.
    """

    __tablename__ = "travel_update_media_assets"

    travel_update_id: Mapped[str] = mapped_column(ForeignKey("travel_updates.id", ondelete="CASCADE"), primary_key=True)
    media_asset_id: Mapped[str] = mapped_column(
        ForeignKey("media_assets.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    travel_update: Mapped[TravelUpdate] = relationship(back_populates="media_links")
    media_asset: Mapped[MediaAsset] = relationship(back_populates="update_links")


class TravelUpdate(Base):
    """A reisupdate: the one record for something that happened on a trip.

    It has a private part and a shared part, kept in separate columns so that
    private text can never reach a visitor by changing a switch.

    Private, always: ``private_notes``, the exact ``location``, the
    attached originals (``media_links``) and the precise ``occurred_at`` time.

    Shared, once ``visibility`` allows it: ``title``, ``body`` (written for
    visitors and empty until the owner writes it), the date at
    ``date_precision``, and the ``chosen_area``. ``area_id``
    always references an area, never a location."""

    __tablename__ = "travel_updates"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    share_id: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    area_id: Mapped[str | None] = mapped_column(ForeignKey("areas.id"), nullable=True)
    location_id: Mapped[str | None] = mapped_column(ForeignKey("locations.id"), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    date_precision: Mapped[DatePrecision] = mapped_column(_enum_column(DatePrecision, "travel_date_precision"))
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    private_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    visibility: Mapped[Visibility] = _visibility_column()
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    trip: Mapped[Trip] = relationship(back_populates="travel_updates")
    chosen_area: Mapped[Area | None] = relationship(foreign_keys=[area_id])
    location: Mapped[Location | None] = relationship(foreign_keys=[location_id])
    media_links: Mapped[list[TravelUpdateMediaAsset]] = relationship(
        back_populates="travel_update", cascade="all, delete-orphan", order_by="TravelUpdateMediaAsset.created_at"
    )

    @property
    def media_asset_ids(self) -> list[str]:
        return [link.media_asset_id for link in self.media_links]

    @property
    def area(self) -> Area | None:
        """The update's area: its location wins; location-less updates name one directly."""
        return (self.location.area if self.location is not None else None) or self.chosen_area


class Stay(Base):
    """An owner-only accommodation, modelled as the nights slept there.

    ``check_in_date`` is the first night and ``check_out_date`` the morning
    of departure, so the stay covers every night ``d`` with
    ``check_in_date <= d < check_out_date``. Both are local calendar dates
    at the accommodation, as are the optional check-in/check-out times.

    Every stay has an ``area`` and, once an accommodation is chosen, a
    ``location`` in that area. While it is undecided the stay is filed under its
    area only: no placeholder location is created for it. A stay's area is its
    own ``area_id``, which always equals the area of its location when it has
    one (the same pattern as a visit or a route end). The location, property and
    booking/contact details are never shareable; sharing a stay shows only its
    area and its nights."""

    __tablename__ = "stays"
    __table_args__ = (CheckConstraint("check_out_date > check_in_date", name="ck_stay_check_out_after_check_in"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    area_id: Mapped[str] = mapped_column(ForeignKey("areas.id"), nullable=False, index=True)
    location_id: Mapped[str | None] = mapped_column(ForeignKey("locations.id"), nullable=True)
    check_in_date: Mapped[date] = mapped_column(Date, nullable=False)
    check_out_date: Mapped[date] = mapped_column(Date, nullable=False)
    check_in_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    check_out_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    status: Mapped[StayStatus] = mapped_column(
        _enum_column(StayStatus, "travel_stay_status"), default=StayStatus.PLANNED
    )
    property_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    website_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    booking_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    contact_details: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # A shared stay is only its city or area and its nights, at this precision;
    # never the property, location or booking details. ``None`` follows the
    # audience; an audience never gets a finer precision than this or its own
    # setting allows (see ``app.precision``).
    visibility: Mapped[Visibility] = _visibility_column()
    share_date_precision: Mapped[DatePrecision | None] = mapped_column(
        _enum_column(DatePrecision, "travel_date_precision"), default=None, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    trip: Mapped[Trip] = relationship(back_populates="stays")
    area: Mapped[Area] = relationship(foreign_keys=[area_id])
    location: Mapped[Location | None] = relationship(foreign_keys=[location_id])
    # Owner-only: the alternative group this stay is compared in, if any. Never delivered to a visitor.
    alternative_membership: Mapped[AlternativeGroupMember | None] = relationship(
        back_populates="stay", cascade="all, delete-orphan", uselist=False
    )
    # Owner-only: the booking confirmations attached to this stay. Never delivered to a visitor.
    document_links: Mapped[list[StayDocumentAsset]] = relationship(
        back_populates="stay", cascade="all, delete-orphan", order_by="StayDocumentAsset.created_at"
    )

    @property
    def document_asset_ids(self) -> list[str]:
        return [link.document_asset_id for link in self.document_links]


class StayDocumentAsset(Base):
    """An owner-only, explicit attachment of a document to a stay.

    The twin of :class:`RouteDocumentAsset`: attaching a booking confirmation gives
    the owner a private reference and never makes the document eligible for
    projection, whatever the stay's visibility.
    """

    __tablename__ = "stay_document_assets"

    stay_id: Mapped[str] = mapped_column(ForeignKey("stays.id", ondelete="CASCADE"), primary_key=True)
    document_asset_id: Mapped[str] = mapped_column(
        ForeignKey("document_assets.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    stay: Mapped[Stay] = relationship(back_populates="document_links")
    document_asset: Mapped[DocumentAsset] = relationship()


class Route(Base):
    """How the traveller gets from one area to another, at any level of detail.

    A route always runs between two *areas*; that is all a visitor ever sees of
    its ends. Everything else is optional and owner-side: the exact departure and
    arrival ``locations`` (a station, an airport), the schedule with each end's
    time zone, carrier, service number, class, booking reference, notes and
    attached documents, and a hand-drawn ``geometry`` line. Without a line the
    maps draw a straight one between the two areas.

    A shared route discloses only its mode and status, its two areas, its
    schedule, carrier and service reference, and the line. Booking references,
    travel class, notes, documents and the exact locations stay owner-only; a
    location appears on a map only when that location is itself shared. The
    application holds no recorded location data a route could be derived from.
    """

    __tablename__ = "routes"
    __table_args__ = (
        CheckConstraint("(departs_at IS NULL) = (arrives_at IS NULL)", name="ck_route_times_paired"),
        CheckConstraint("arrives_at > departs_at", name="ck_route_arrival_after_departure"),
        CheckConstraint("departs_at IS NULL OR departs_on IS NOT NULL", name="ck_route_time_needs_a_day"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    mode: Mapped[RouteMode] = mapped_column(_enum_column(RouteMode, "travel_route_mode"), default=RouteMode.OTHER)
    status: Mapped[RouteStatus] = mapped_column(
        _enum_column(RouteStatus, "travel_route_status"), default=RouteStatus.PLANNED
    )
    # A name for the route; without one it is shown as "<from> → <to>".
    label: Mapped[str | None] = mapped_column(String(160), nullable=True)
    departure_area_id: Mapped[str] = mapped_column(ForeignKey("areas.id"), nullable=False)
    arrival_area_id: Mapped[str] = mapped_column(ForeignKey("areas.id"), nullable=False)
    departure_location_id: Mapped[str | None] = mapped_column(ForeignKey("locations.id"), nullable=True)
    arrival_location_id: Mapped[str | None] = mapped_column(ForeignKey("locations.id"), nullable=True)
    # The local calendar day of departure, in the departure time zone. A route
    # can have a day before it has a train ("Kaohsiung → Taipei on 5 December");
    # once ``departs_at`` is set, this is always its local date.
    departs_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    departs_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    arrives_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # IANA zones of each end. When set, the owner enters and reads the local
    # wall-clock time there; the instants above stay in UTC.
    departure_timezone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    arrival_timezone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    carrier: Mapped[str | None] = mapped_column(String(160), nullable=True)
    service_reference: Mapped[str | None] = mapped_column(String(40), nullable=True)
    travel_class: Mapped[str | None] = mapped_column(String(80), nullable=True)
    booking_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # An owner-drawn, approximate GeoJSON line; optional.
    geometry: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    visibility: Mapped[Visibility] = _visibility_column()
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    trip: Mapped[Trip] = relationship(back_populates="routes")
    # Owner-only: the alternative group this route is compared in, if any. Never delivered to a visitor.
    alternative_membership: Mapped[AlternativeGroupMember | None] = relationship(
        back_populates="route", cascade="all, delete-orphan", uselist=False
    )
    departure_area: Mapped[Area] = relationship(foreign_keys=[departure_area_id])
    arrival_area: Mapped[Area] = relationship(foreign_keys=[arrival_area_id])
    departure_location: Mapped[Location | None] = relationship(foreign_keys=[departure_location_id])
    arrival_location: Mapped[Location | None] = relationship(foreign_keys=[arrival_location_id])
    document_links: Mapped[list[RouteDocumentAsset]] = relationship(
        back_populates="route", cascade="all, delete-orphan", order_by="RouteDocumentAsset.created_at"
    )

    @property
    def document_asset_ids(self) -> list[str]:
        return [link.document_asset_id for link in self.document_links]


class RouteDocumentAsset(Base):
    """An owner-only, explicit attachment of a document to a route.

    Deliberately separate from a share derivative, exactly like
    :class:`TravelUpdateMediaAsset`: attaching a document gives the owner a
    private booking-material reference and never makes it eligible for
    projection.
    """

    __tablename__ = "route_document_assets"

    route_id: Mapped[str] = mapped_column(ForeignKey("routes.id", ondelete="CASCADE"), primary_key=True)
    document_asset_id: Mapped[str] = mapped_column(
        ForeignKey("document_assets.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    route: Mapped[Route] = relationship(back_populates="document_links")
    document_asset: Mapped[DocumentAsset] = relationship()


class Visit(Base):
    """A stop on the trip: somewhere the traveller is, or goes, and when.

    A visit is at an *area*, or at a *location* in one, and can carry the days it
    spans, a start and end time and a kind (free or working days).

    It has a private part (``notes``, the ``status``, the exact ``location``, and
    the times unless ``share_time`` is set) and a shared part (``title``, ``summary``, the area, the
    days at ``share_date_precision``), held in separate fields so private text
    can never reach a visitor by changing a switch.
    """

    __tablename__ = "visits"
    __table_args__ = (
        UniqueConstraint("trip_id", "position", name="uq_visit_position"),
        CheckConstraint(
            "ends_on IS NULL OR (starts_on IS NOT NULL AND ends_on >= starts_on)", name="ck_visit_last_day"
        ),
        CheckConstraint("start_time IS NULL OR starts_on IS NOT NULL", name="ck_visit_time_needs_a_day"),
        CheckConstraint("end_time IS NULL OR start_time IS NOT NULL", name="ck_visit_end_time_needs_a_start"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    area_id: Mapped[str] = mapped_column(ForeignKey("areas.id"), nullable=False, index=True)
    location_id: Mapped[str | None] = mapped_column(ForeignKey("locations.id"), nullable=True)
    # Without a title a visit goes by the name of its location, else of its area.
    title: Mapped[str | None] = mapped_column(String(160), nullable=True)
    kind: Mapped[VisitKind | None] = mapped_column(_enum_column(VisitKind, "travel_visit_kind"), nullable=True)
    # Owner-only planning state; never part of a shared visit.
    status: Mapped[VisitStatus] = mapped_column(
        _enum_column(VisitStatus, "travel_visit_status"), default=VisitStatus.PLANNED, nullable=False
    )
    starts_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Inclusive last day of a multi-day visit such as "18-20 nov".
    ends_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Local wall-clock times at the visit; the time zone is the area's.
    start_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    end_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    visibility: Mapped[Visibility] = _visibility_column()
    # Whether a shared visit also shows its times. A separate choice from sharing the visit at all.
    # ``share_date_precision`` is this visit's own cap on its days; ``None`` follows the audience.
    share_time: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    share_date_precision: Mapped[DatePrecision | None] = mapped_column(
        _enum_column(DatePrecision, "travel_date_precision"), default=None, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    trip: Mapped[Trip] = relationship(back_populates="visits")
    area: Mapped[Area] = relationship(foreign_keys=[area_id])
    location: Mapped[Location | None] = relationship(foreign_keys=[location_id])
    # Owner-only: the alternative group this visit is compared in, if any. Never delivered to a visitor.
    alternative_membership: Mapped[AlternativeGroupMember | None] = relationship(
        back_populates="visit", cascade="all, delete-orphan", uselist=False
    )


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


class TripTask(Base):
    """An owner-only lightweight booking/preparation task.

    Deliberately has no ordering or linked-resource fields -- it's a
    checklist, not the agenda. ``completed_at`` is set by the router, never
    accepted directly from a client payload, so an owner can't backdate a
    completion.
    """

    __tablename__ = "trip_tasks"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    remind_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reminded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Owner-chosen HTTPS references such as a ticket or booking site:
    # ``[{"label": ..., "url": ...}]``.
    links: Mapped[list[dict]] = mapped_column(JSON, default=list, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    trip: Mapped[Trip] = relationship(back_populates="trip_tasks")


class TripTaskAlert(Base):
    """Owner inbox item produced once by the scheduled task processor."""

    __tablename__ = "trip_task_alerts"
    __table_args__ = (UniqueConstraint("task_id", "kind", "scheduled_for", name="uq_trip_task_alert_schedule"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    task_id: Mapped[str] = mapped_column(ForeignKey("trip_tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    owner_subject: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    scheduled_for: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    email_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    email_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    email_last_error: Mapped[str | None] = mapped_column(String(120), nullable=True)


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
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    scope: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    # Display label only (#241): the preset last applied to this audience and when. Nothing that decides what an
    # audience receives (projection, files, navigation, `access.receivers`) ever reads it.
    applied_preset: Mapped[str | None] = mapped_column(String(32), nullable=True)
    applied_preset_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ShareLink(Base):
    """A named, revocable, high-entropy unlisted URL. The owner-managed URL
    is stored so its owner can copy it again later; the separate keyed
    verifier remains the only value used for anonymous delivery. `state`
    gates whether the URL works at all; while `active`, `scope` is live and
    editing it takes effect immediately for anyone holding the URL — content
    and scope both render from current canonical data on every exchange,
    never a frozen snapshot."""

    __tablename__ = "share_links"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    # Stable across rotations, so the owner sees one link and its prior URLs
    # as history rather than unrelated records.
    series_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    state: Mapped[LinkState] = mapped_column(_enum_column(LinkState, "travel_link_state"), default=LinkState.DRAFT)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    scope: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    # Display label only (#241): the preset last applied to this audience and when. Nothing that decides what an
    # audience receives (projection, files, navigation, `access.receivers`) ever reads it.
    applied_preset: Mapped[str | None] = mapped_column(String(32), nullable=True)
    applied_preset_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    token: Mapped[str | None] = mapped_column(String(128), nullable=True)
    token_verifier: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Collection(Base):
    """An owner-wide, named, revocable capability that opens several trips at once.

    It has its own token and keyed verifier and never reuses a per-trip link's.
    `state` gates the whole collection; each member owns the scope its trip is
    delivered at, so a collection can show less than the trip's own links.
    Everything renders live from canonical data -- there is no snapshot. The
    label is owner-only; `title` is optional text written for visitors."""

    __tablename__ = "collections"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    owner_subject: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    title: Mapped[str | None] = mapped_column(String(160), nullable=True)
    state: Mapped[LinkState] = mapped_column(_enum_column(LinkState, "travel_link_state"), default=LinkState.DRAFT)
    token: Mapped[str | None] = mapped_column(String(128), nullable=True)
    token_verifier: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Counts completed rotations, so the owner sees the capability was replaced.
    rotations: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    members: Mapped[list[CollectionMember]] = relationship(
        back_populates="collection", cascade="all, delete-orphan", order_by="CollectionMember.created_at"
    )


class CollectionMember(Base):
    """One trip in a collection, with the scope the collection delivers it at.

    `id` is the opaque identifier visitors see in the path instead of the trip's
    own id. A member disappears with its trip or its collection."""

    __tablename__ = "collection_members"
    __table_args__ = (UniqueConstraint("collection_id", "trip_id", name="uq_collection_members_trip"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    collection_id: Mapped[str] = mapped_column(
        ForeignKey("collections.id", ondelete="CASCADE"), nullable=False, index=True
    )
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    scope: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    # Display label only (#241): the preset last applied to this audience and when. Nothing that decides what an
    # audience receives (projection, files, navigation, `access.receivers`) ever reads it.
    applied_preset: Mapped[str | None] = mapped_column(String(32), nullable=True)
    applied_preset_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    collection: Mapped[Collection] = relationship(back_populates="members")


class CollectionAuditEvent(Base):
    """Owner-only audit trail for collection lifecycle and membership changes.

    Collections belong to the owner, not a trip, so these events are kept apart
    from `AuditEvent`. Ids are kept after a collection or trip is deleted. Like
    `AuditEvent`, `details` never holds a raw token or recipient identity.
    Retained and purged with the other sharing audits."""

    __tablename__ = "collection_audit_events"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    owner_subject: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    actor_subject: Mapped[str] = mapped_column(String(255), nullable=False)
    collection_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    trip_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    kind: Mapped[str] = mapped_column(String(60), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    details: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)


class AuditEvent(Base):
    """Owner-only audit trail for publication/share-link lifecycle
    transitions (`travel/audit-event@1`). `details` records only
    link/projection ids, a scope fingerprint and owner-facing metadata --
    never a raw capability token, recipient identity or recipient IP, since
    an unlisted link is a forwardable capability and recording who redeemed
    it would defeat that model. Retained per the sharing policy's 24-month
    window; `purge_expired_audit_events` (`app.audit`) hard-deletes rows past
    it."""

    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    actor_subject: Mapped[str] = mapped_column(String(255), nullable=False)
    kind: Mapped[AuditEventKind] = mapped_column(_enum_column(AuditEventKind, "travel_audit_event_kind"))
    target_type: Mapped[AuditTargetType] = mapped_column(_enum_column(AuditTargetType, "travel_audit_target_type"))
    target_id: Mapped[str] = mapped_column(String(32), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    details: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)


class McpAuditEvent(Base):
    """Append-only record of an authenticated owner MCP tool invocation.

    This is intentionally distinct from :class:`AuditEvent`, whose small,
    audience-safe vocabulary records publication-link lifecycle changes.  MCP
    tools need an owner operational audit for *every* invocation, including a
    rejected one, without ever recording request bodies, uploaded bytes, or a
    share-link URL.
    """

    __tablename__ = "mcp_audit_events"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    owner_subject: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(120), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(80), nullable=False)
    resource_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Keep the trip identifier after the trip itself is permanently deleted.
    trip_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    result: Mapped[str] = mapped_column(String(16), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    # Only a stable error code/message summary belongs here.  Never persist a
    # tool payload: it can contain private notes, raw media, OAuth tokens, or
    # share capabilities.
    details: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)


class StoredObject(Base):
    """Object-storage inventory for one trip-owned file.

    A row moves `staged` -> `available` only after its checksum is verified
    against the just-written bytes; only an `available` object may back a
    `MediaAsset` or `MediaDerivative`. Two uploads of identical bytes for the
    same trip reuse one row (`uq_stored_object_trip_sha256`): deduplication
    never crosses trips/owners. Detached purge inventory has no trip link and
    survives trip deletion until the locked maintenance purge succeeds.
    """

    __tablename__ = "stored_objects"
    __table_args__ = (UniqueConstraint("trip_id", "sha256", name="uq_stored_object_trip_sha256"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str | None] = mapped_column(ForeignKey("trips.id", ondelete="SET NULL"), nullable=True, index=True)
    bucket: Mapped[str] = mapped_column(String(64), nullable=False, default="media")
    object_key: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    byte_size: Mapped[int] = mapped_column(Integer, nullable=False)
    content_type: Mapped[str] = mapped_column(String(120), nullable=False)
    state: Mapped[ObjectState] = mapped_column(
        _enum_column(ObjectState, "travel_object_state"), default=ObjectState.STAGED
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ImportSession(Base):
    """A Google Photos Picker / GoPro Cloud selection session for one owner.

    `provider_session_id` and any provider handle needed to poll selection
    status are owner-only provenance; they are never serialized to a client
    beyond the id needed to call `complete` again. A session starts `pending`
    and becomes `completed` once the owner's selection has been imported (an
    import may be completed more than once, safely, by retrying)."""

    __tablename__ = "import_sessions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    provider: Mapped[ImportProvider] = mapped_column(_enum_column(ImportProvider, "travel_import_provider"))
    provider_session_id: Mapped[str] = mapped_column(String(255), nullable=False)
    state: Mapped[ImportSessionState] = mapped_column(
        _enum_column(ImportSessionState, "travel_import_session_state"), default=ImportSessionState.PENDING
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ImportRecord(Base):
    """Provenance for one imported media item.

    Uniqueness on `(trip_id, provider, provider_item_id)` makes completing an
    import session idempotent: retrying it after a partial failure only
    (re)fetches items that do not already have a `completed` row. A provider
    access token is never stored here; it lives only in the secret store
    (`app.secrets`) for the lifetime the owner allows."""

    __tablename__ = "import_records"
    __table_args__ = (
        UniqueConstraint("trip_id", "provider", "provider_item_id", name="uq_import_record_provider_item"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    provider: Mapped[ImportProvider] = mapped_column(_enum_column(ImportProvider, "travel_import_provider"))
    provider_item_id: Mapped[str] = mapped_column(String(255), nullable=False)
    state: Mapped[ImportState] = mapped_column(
        _enum_column(ImportState, "travel_import_state"), default=ImportState.PENDING
    )
    media_asset_id: Mapped[str | None] = mapped_column(
        ForeignKey("media_assets.id", ondelete="SET NULL", use_alter=True, name="fk_import_records_media_asset_id"),
        nullable=True,
    )
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failure_code: Mapped[str | None] = mapped_column(String(120), nullable=True)


class MediaAsset(Base):
    """One imported/uploaded original. Raw EXIF/XMP/IPTC and camera data in
    `raw_metadata` are owner-only and never leave an owner-audience response;
    `original_object_id` always points to a copy in Travel-controlled object
    storage, never a provider URL."""

    __tablename__ = "media_assets"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    original_object_id: Mapped[str] = mapped_column(ForeignKey("stored_objects.id"), unique=True, nullable=False)
    media_kind: Mapped[MediaKind] = mapped_column(_enum_column(MediaKind, "travel_media_kind"))
    captured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # True when `captured_at` is the camera's wall-clock time as written in EXIF (stored with a nominal UTC label),
    # not an instant; it is shown unchanged in any viewer zone. See docs/decisions/297-exif-capture-time.md.
    captured_local: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false(), nullable=False)
    import_id: Mapped[str | None] = mapped_column(ForeignKey("import_records.id"), nullable=True)
    raw_metadata: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    original_object: Mapped[StoredObject] = relationship(foreign_keys=[original_object_id])
    derivatives: Mapped[list[MediaDerivative]] = relationship(
        back_populates="media_asset", cascade="all, delete-orphan"
    )
    update_links: Mapped[list[TravelUpdateMediaAsset]] = relationship(back_populates="media_asset")


class MediaDerivative(Base):
    """A stripped, resized copy of one `MediaAsset`, generated only when the
    owner selects that media for `share`/`static_export` publication (or, for
    `owner_preview`, for an in-app thumbnail). `metadata_stripped_at` records
    when stripping ran; `review_state` gates whether a `share`/`static_export`
    purpose may ever be referenced by a `scope_json` item — a derivative is
    usable for sharing only once the owner has explicitly reviewed it."""

    __tablename__ = "media_derivatives"
    __table_args__ = (
        Index(
            "uq_media_derivatives_trip_cover",
            "trip_id",
            unique=True,
            postgresql_where=text("is_cover"),
            sqlite_where=text("is_cover"),
        ),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    media_asset_id: Mapped[str] = mapped_column(
        ForeignKey("media_assets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    object_id: Mapped[str | None] = mapped_column(ForeignKey("stored_objects.id"), nullable=True)
    poster_object_id: Mapped[str | None] = mapped_column(ForeignKey("stored_objects.id"), nullable=True)
    processing_state: Mapped[DerivativeProcessingState] = mapped_column(
        _enum_column(DerivativeProcessingState, "travel_derivative_processing_state"),
        default=DerivativeProcessingState.READY,
        nullable=False,
    )
    processing_backend: Mapped[str] = mapped_column(String(10), default="local", server_default="local")
    processing_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    remove_audio: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    purpose: Mapped[DerivativePurpose] = mapped_column(_enum_column(DerivativePurpose, "travel_derivative_purpose"))
    metadata_stripped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_state: Mapped[DerivativeReviewState] = mapped_column(
        _enum_column(DerivativeReviewState, "travel_derivative_review_state"), default=DerivativeReviewState.PENDING
    )
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    travel_update_id: Mapped[str | None] = mapped_column(
        ForeignKey("travel_updates.id", ondelete="SET NULL"), nullable=True
    )
    caption: Mapped[str | None] = mapped_column(String(500), nullable=True)
    alt_text: Mapped[str | None] = mapped_column(String(300), nullable=True)
    focal_x: Mapped[int | None] = mapped_column(Integer, nullable=True)
    focal_y: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # A photo attached to a reisupdate is delivered with that update and this
    # choice is ignored; it only governs a loose gallery photo.
    visibility: Mapped[Visibility] = _visibility_column()
    # The owner's choice of this photo as its trip's cover, at most one per trip.
    # It only nominates the photo: an audience shows it only when it already
    # receives this derivative, so it never grants publication on its own.
    is_cover: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    trip: Mapped[Trip] = relationship(back_populates="media_derivatives")
    media_asset: Mapped[MediaAsset] = relationship(back_populates="derivatives")
    object: Mapped[StoredObject | None] = relationship(foreign_keys=[object_id])
    poster_object: Mapped[StoredObject | None] = relationship(foreign_keys=[poster_object_id])


class DocumentAsset(Base):
    """One owner-only original document.

    The original object and its metadata remain behind owner authentication.
    """

    __tablename__ = "document_assets"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    original_object_id: Mapped[str] = mapped_column(ForeignKey("stored_objects.id"), unique=True, nullable=False)
    document_kind: Mapped[DocumentKind] = mapped_column(_enum_column(DocumentKind, "travel_document_kind"))
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    owner_metadata: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    original_object: Mapped[StoredObject] = relationship(foreign_keys=[original_object_id])


class OwnerStoredObject(Base):
    """Object-storage inventory for one owner-wide (trip-independent) file.

    Mirrors :class:`StoredObject` field-for-field but is keyed by
    ``owner_subject`` instead of ``trip_id``, since the owner-wide document
    library is deliberately not attached to any trip. Kept as a separate
    table rather than making ``StoredObject.trip_id`` nullable, so the
    trip-scoped media/document pipeline is untouched.
    """

    __tablename__ = "owner_stored_objects"
    __table_args__ = (UniqueConstraint("owner_subject", "sha256", name="uq_owner_stored_object_owner_sha256"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    owner_subject: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    bucket: Mapped[str] = mapped_column(String(64), nullable=False, default="library")
    object_key: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    byte_size: Mapped[int] = mapped_column(Integer, nullable=False)
    content_type: Mapped[str] = mapped_column(String(120), nullable=False)
    state: Mapped[ObjectState] = mapped_column(
        _enum_column(ObjectState, "travel_object_state"), default=ObjectState.STAGED
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class OwnerDocument(Base):
    """One owner-wide document original: a reusable policy, identity copy or
    other travel essential that is not tied to a specific trip.

    ``linked_trip_id`` is an optional, real foreign key because a document
    here can only ever link to a trip. Deleting the linked trip clears the
    link rather than the document (``ondelete="SET NULL"``); the document
    itself is owner-wide and outlives any one trip.
    """

    __tablename__ = "owner_documents"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    owner_subject: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    original_object_id: Mapped[str] = mapped_column(ForeignKey("owner_stored_objects.id"), unique=True, nullable=False)
    document_kind: Mapped[DocumentKind] = mapped_column(_enum_column(DocumentKind, "travel_document_kind"))
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    owner_metadata: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    linked_trip_id: Mapped[str | None] = mapped_column(
        ForeignKey("trips.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    original_object: Mapped[OwnerStoredObject] = relationship(foreign_keys=[original_object_id])
    linked_trip: Mapped[Trip | None] = relationship(foreign_keys=[linked_trip_id])


class EmergencyInfoEntry(Base):
    """One owner-only emergency-information entry: a contact, a relevant
    number, or a concise medical/assistance note.

    Deliberately trip-independent and file-free, so it is hard-deleted like
    :class:`TripTask`/:class:`Visit` rather than soft-deleted like
    the file-backed resources.
    """

    __tablename__ = "emergency_info_entries"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    owner_subject: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    kind: Mapped[EmergencyInfoKind] = mapped_column(_enum_column(EmergencyInfoKind, "travel_emergency_info_kind"))
    label: Mapped[str] = mapped_column(String(160), nullable=False)
    value: Mapped[str] = mapped_column(String(255), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class MediaWorkerJob(Base):
    """Private durable outbox; survives derivative/asset deletion to cancel and ACK remote work."""

    __tablename__ = "media_worker_jobs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    derivative_id: Mapped[str | None] = mapped_column(
        ForeignKey("media_derivatives.id", ondelete="SET NULL"), unique=True, nullable=True
    )
    worker_id: Mapped[str | None] = mapped_column(String(32), unique=True, nullable=True)
    profile: Mapped[str] = mapped_column(String(40), default="travel-video-v1")
    remove_audio: Mapped[bool] = mapped_column(Boolean, nullable=False)
    source_key: Mapped[str] = mapped_column(String(300))
    source_sha256: Mapped[str] = mapped_column(String(64))
    state: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    error_code: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
