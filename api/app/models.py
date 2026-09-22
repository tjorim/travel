import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import CheckConstraint, DateTime, Enum, Float, ForeignKey, Integer, String, Text, UniqueConstraint, func
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


class ImportProvider(StrEnum):
    DIRECT_DEVICE = "direct_device"
    GOOGLE_PHOTOS_PICKER = "google_photos_picker"
    GOPRO_CLOUD = "gopro_cloud"


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


class PlaceKind(StrEnum):
    EXACT = "exact"
    BROAD = "broad"


class DatePrecision(StrEnum):
    DAY = "day"
    MONTH = "month"
    YEAR = "year"


class StayStatus(StrEnum):
    PLANNED = "planned"
    BOOKED = "booked"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"


class TrackKind(StrEnum):
    GPX = "gpx"
    POINT_ARRAY = "point_array"


class AuditEventKind(StrEnum):
    PUBLIC_PROJECTION_PUBLISH = "public_projection.publish"
    PUBLIC_PROJECTION_UNPUBLISH = "public_projection.unpublish"
    SHARE_LINK_CREATE = "share_link.create"
    SHARE_LINK_ACTIVATE = "share_link.activate"
    SHARE_LINK_REVOKE = "share_link.revoke"
    SHARE_LINK_ROTATE = "share_link.rotate"
    SHARE_LINK_EXPIRE = "share_link.expire"


class AuditTargetType(StrEnum):
    PUBLIC_SURFACE = "public_surface"
    SHARE_LINK = "share_link"


def _enum_column(enum_cls: type[StrEnum], name: str):
    return Enum(enum_cls, name=name, values_callable=lambda enum: [member.value for member in enum])


class Place(Base):
    """The canonical `travel/place@1` split: an `exact` row (address parts,
    coordinates, viewport, navigation/provider IDs, notes) or a `broad` row
    (label, country/region, optional approved generalized point). A broad
    row may set `parent_exact_place_id` for owner traceability to its exact
    source; that reference is owner-only and never appears in a shared
    response. `RouteStage` and `MomentExcerpt` only ever reference a `broad`
    row; `Moment` only ever references an `exact` row -- enforced by the
    router, since a single FK-target table can't itself express the
    per-column kind split."""

    __tablename__ = "places"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    kind: Mapped[PlaceKind] = mapped_column(_enum_column(PlaceKind, "travel_place_kind"))
    parent_exact_place_id: Mapped[str | None] = mapped_column(ForeignKey("places.id"), nullable=True)

    # Broad-only fields.
    label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    region: Mapped[str | None] = mapped_column(String(120), nullable=True)

    # Exact address country, or broad country -- shared by both kinds.
    country_code: Mapped[str | None] = mapped_column(String(2), nullable=True)

    # Exact coordinates, or broad's optional approved generalized point.
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Exact-only fields.
    address_line1: Mapped[str | None] = mapped_column(String(160), nullable=True)
    address_line2: Mapped[str | None] = mapped_column(String(160), nullable=True)
    locality: Mapped[str | None] = mapped_column(String(120), nullable=True)
    admin_area: Mapped[str | None] = mapped_column(String(120), nullable=True)
    postal_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
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
    moment_excerpts: Mapped[list["MomentExcerpt"]] = relationship(
        back_populates="trip", cascade="all, delete-orphan", order_by="MomentExcerpt.created_at"
    )
    stays: Mapped[list["Stay"]] = relationship(
        back_populates="trip", cascade="all, delete-orphan", order_by="Stay.arrives_at"
    )
    broad_stay_cards: Mapped[list["BroadStayCard"]] = relationship(
        back_populates="trip", cascade="all, delete-orphan", order_by="BroadStayCard.created_at"
    )
    recorded_tracks: Mapped[list["RecordedTrack"]] = relationship(
        back_populates="trip", cascade="all, delete-orphan", order_by="RecordedTrack.started_at"
    )
    broad_routes: Mapped[list["BroadRoute"]] = relationship(
        back_populates="trip", cascade="all, delete-orphan", order_by="BroadRoute.created_at"
    )


class RouteStage(Base):
    __tablename__ = "route_stages"
    __table_args__ = (UniqueConstraint("trip_id", "position", name="uq_route_stage_position"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    broad_place_id: Mapped[str] = mapped_column(ForeignKey("places.id"), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    label: Mapped[str | None] = mapped_column(String(120), nullable=True)

    trip: Mapped[Trip] = relationship(back_populates="route_stages")
    place: Mapped[Place] = relationship(foreign_keys=[broad_place_id])


class Moment(Base):
    __tablename__ = "moments"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    exact_place_id: Mapped[str | None] = mapped_column(ForeignKey("places.id"), nullable=True)
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
    place: Mapped[Place | None] = relationship(foreign_keys=[exact_place_id])


class MomentExcerpt(Base):
    """A standalone approved excerpt (`travel/moment-excerpt@1`), independent
    of its optional source moment's lifecycle. `source_moment_id` is
    owner-only provenance: it is optional so the excerpt can outlive a
    deleted journal item, and it is set null (never cascaded) when that
    moment is deleted. `broad_place_id` always references a `broad` place,
    never an `exact` one."""

    __tablename__ = "moment_excerpts"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    source_moment_id: Mapped[str | None] = mapped_column(ForeignKey("moments.id", ondelete="SET NULL"), nullable=True)
    broad_place_id: Mapped[str | None] = mapped_column(ForeignKey("places.id"), nullable=True)
    date_precision: Mapped[DatePrecision] = mapped_column(_enum_column(DatePrecision, "travel_date_precision"))
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    trip: Mapped[Trip] = relationship(back_populates="moment_excerpts")
    broad_place: Mapped[Place | None] = relationship(foreign_keys=[broad_place_id])


class Stay(Base):
    """An owner-only accommodation record. Its exact place, dates and
    booking/contact details are intentionally not shareable; a traveller who
    wants to share a stay authors a separate :class:`BroadStayCard` instead."""

    __tablename__ = "stays"
    __table_args__ = (CheckConstraint("departs_at > arrives_at", name="ck_stay_departure_after_arrival"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    exact_place_id: Mapped[str] = mapped_column(ForeignKey("places.id"), nullable=False)
    arrives_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    departs_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[StayStatus] = mapped_column(
        _enum_column(StayStatus, "travel_stay_status"), default=StayStatus.PLANNED
    )
    property_name: Mapped[str] = mapped_column(String(160), nullable=False)
    booking_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    contact_details: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    trip: Mapped[Trip] = relationship(back_populates="stays")
    place: Mapped[Place] = relationship(foreign_keys=[exact_place_id])


class BroadStayCard(Base):
    """A deliberately authored, share-safe stay summary.

    The card has no stay foreign key: selecting one for a future projection
    can never follow an implicit path to a stay's exact place, dates or
    booking data.
    """

    __tablename__ = "broad_stay_cards"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    broad_place_id: Mapped[str] = mapped_column(ForeignKey("places.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    date_precision: Mapped[DatePrecision] = mapped_column(_enum_column(DatePrecision, "travel_date_precision"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    trip: Mapped[Trip] = relationship(back_populates="broad_stay_cards")
    place: Mapped[Place] = relationship(foreign_keys=[broad_place_id])


class RecordedTrack(Base):
    """A finished, owner-uploaded raw GPS recording.

    The track's source object contains the precise points, timestamps and
    optional speed/elevation values. It is intentionally unrelated to a
    :class:`BroadRoute`: a shareable route is an independent, owner-authored
    resource and is never generated from these raw bytes at read time.
    """

    __tablename__ = "recorded_tracks"
    __table_args__ = (CheckConstraint("ended_at > started_at", name="ck_track_end_after_start"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    source_object_id: Mapped[str] = mapped_column(ForeignKey("stored_objects.id"), unique=True, nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    kind: Mapped[TrackKind] = mapped_column(_enum_column(TrackKind, "travel_track_kind"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    trip: Mapped[Trip] = relationship(back_populates="recorded_tracks")
    source_object: Mapped["StoredObject"] = relationship(foreign_keys=[source_object_id])


class BroadRoute(Base):
    """An owner-reviewed generalized geometry safe for a later projection.

    It deliberately has no raw-track foreign key. That makes the review and
    generalization step explicit, and removes any path for public rendering
    to infer a line from precise recording data.
    """

    __tablename__ = "broad_routes"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    label: Mapped[str] = mapped_column(String(160), nullable=False)
    geometry: Mapped[dict] = mapped_column(JSON, nullable=False)
    date_precision: Mapped[DatePrecision] = mapped_column(_enum_column(DatePrecision, "travel_date_precision"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    trip: Mapped[Trip] = relationship(back_populates="broad_routes")


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


class StoredObject(Base):
    """Object-storage inventory for one trip-owned file.

    A row moves `staged` -> `available` only after its checksum is verified
    against the just-written bytes; only an `available` object may back a
    `MediaAsset` or `MediaDerivative`. Two uploads of identical bytes for the
    same trip reuse one row (`uq_stored_object_trip_sha256`): deduplication
    never crosses trips/owners.
    """

    __tablename__ = "stored_objects"
    __table_args__ = (UniqueConstraint("trip_id", "sha256", name="uq_stored_object_trip_sha256"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
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
    original_object_id: Mapped[str] = mapped_column(
        ForeignKey("stored_objects.id"), unique=True, nullable=False
    )
    media_kind: Mapped[MediaKind] = mapped_column(_enum_column(MediaKind, "travel_media_kind"))
    captured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    import_id: Mapped[str | None] = mapped_column(ForeignKey("import_records.id"), nullable=True)
    raw_metadata: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    original_object: Mapped[StoredObject] = relationship(foreign_keys=[original_object_id])
    derivatives: Mapped[list["MediaDerivative"]] = relationship(
        back_populates="media_asset", cascade="all, delete-orphan"
    )


class MediaDerivative(Base):
    """A stripped, resized copy of one `MediaAsset`, generated only when the
    owner selects that media for `share`/`static_export` publication (or, for
    `owner_preview`, for an in-app thumbnail). `metadata_stripped_at` records
    when stripping ran; `review_state` gates whether a `share`/`static_export`
    purpose may ever be referenced by a `scope_json` item — a derivative is
    usable for sharing only once the owner has explicitly reviewed it."""

    __tablename__ = "media_derivatives"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    media_asset_id: Mapped[str] = mapped_column(
        ForeignKey("media_assets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    object_id: Mapped[str] = mapped_column(ForeignKey("stored_objects.id"), unique=True, nullable=False)
    purpose: Mapped[DerivativePurpose] = mapped_column(_enum_column(DerivativePurpose, "travel_derivative_purpose"))
    metadata_stripped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_state: Mapped[DerivativeReviewState] = mapped_column(
        _enum_column(DerivativeReviewState, "travel_derivative_review_state"), default=DerivativeReviewState.PENDING
    )
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    media_asset: Mapped[MediaAsset] = relationship(back_populates="derivatives")
    object: Mapped[StoredObject] = relationship(foreign_keys=[object_id])


class DocumentAsset(Base):
    """One owner-only original document.

    The original object, its filename and every piece of derived private data
    remain behind owner authentication. A shareable file is always represented
    by a separate :class:`DocumentDerivative`; no code may project this row's
    ``original_object_id`` to another audience.
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
    derivatives: Mapped[list["DocumentDerivative"]] = relationship(
        back_populates="document_asset", cascade="all, delete-orphan"
    )


class DocumentDerivative(Base):
    """An owner-supplied redacted copy plus its durable redaction manifest.

    The API deliberately does not offer a transform-from-original endpoint:
    redaction is an explicit authoring/review step. ``review_state`` starts
    pending and is the gate that a later share-scope implementation will use.
    """

    __tablename__ = "document_derivatives"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=opaque_id)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True)
    document_asset_id: Mapped[str] = mapped_column(
        ForeignKey("document_assets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    object_id: Mapped[str] = mapped_column(ForeignKey("stored_objects.id"), unique=True, nullable=False)
    redaction_manifest_object_id: Mapped[str] = mapped_column(
        ForeignKey("stored_objects.id"), unique=True, nullable=False
    )
    review_state: Mapped[DerivativeReviewState] = mapped_column(
        _enum_column(DerivativeReviewState, "travel_derivative_review_state"), default=DerivativeReviewState.PENDING
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    document_asset: Mapped[DocumentAsset] = relationship(back_populates="derivatives")
    object: Mapped[StoredObject] = relationship(foreign_keys=[object_id])
    redaction_manifest_object: Mapped[StoredObject] = relationship(foreign_keys=[redaction_manifest_object_id])
