"""Closed vocabularies stored as enum columns, and the live-location delay choices."""

from __future__ import annotations

from enum import StrEnum

from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SurfaceState(StrEnum):
    UNPUBLISHED = "unpublished"
    PUBLISHED = "published"


class LinkState(StrEnum):
    DRAFT = "draft"
    ACTIVE = "active"
    REVOKED = "revoked"
    EXPIRED = "expired"


class LiveAudienceKind(StrEnum):
    """Who a live-location setting is for: the public view, or one hidden link."""

    PUBLIC = "public"
    LINK = "link"


class LivePrecision(StrEnum):
    EXACT = "exact"
    KM1 = "1km"
    KM10 = "10km"


# The delays an owner may choose for a live-location audience, in seconds (decision 244).
LIVE_DELAYS = (0, 900, 1800, 3600, 7200, 86400)


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


class DerivativeReviewState(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"


class DerivativeProcessingBackend(StrEnum):
    """Where a derivative is produced: in this process, by the remote media worker, or as an owner thumbnail."""

    LOCAL = "local"
    REMOTE = "remote"
    THUMBNAIL = "thumbnail"


class DerivativeProcessingState(StrEnum):
    PROCESSING = "processing"
    FAILED = "failed"
    READY = "ready"


class DatePrecision(StrEnum):
    DAY = "day"
    MONTH = "month"
    YEAR = "year"


class PlanningStatus(StrEnum):
    """How settled a stay, route or visit is: an idea (a candidate being compared), planned,
    confirmed, or cancelled (dropped).

    Owner-only planning state, kept here instead of in a title or area label (which visitors
    see). It is never shared. Areas carry no status of their own: an area is as settled as the
    visits in it."""

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


class TaskAlertKind(StrEnum):
    REMINDER = "reminder"


class AuditEventKind(StrEnum):
    """The code list of sharing audit events. The column is a plain string checked against this list when a row is
    written, so adding a kind needs no migration."""

    PUBLIC_PROJECTION_PUBLISH = "public_projection.publish"
    PUBLIC_PROJECTION_UNPUBLISH = "public_projection.unpublish"
    SHARE_LINK_CREATE = "share_link.create"
    SHARE_LINK_ACTIVATE = "share_link.activate"
    SHARE_LINK_REVOKE = "share_link.revoke"
    SHARE_LINK_ROTATE = "share_link.rotate"
    FEED_ENABLE = "feed.enable"
    FEED_ROTATE = "feed.rotate"
    FEED_REVOKE = "feed.revoke"
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
    # Named after the audience it targets, like the scope changes; a collection member's apply is a collection event.
    PUBLIC_PROJECTION_PRESET_APPLY = "public_projection.preset_apply"
    SHARE_LINK_PRESET_APPLY = "share_link.preset_apply"


class CollectionAuditKind(StrEnum):
    """The code list of collection audit events (validated at write time, like `AuditEventKind`)."""

    CREATE = "collection.create"
    UPDATE = "collection.update"
    DELETE = "collection.delete"
    ACTIVATE = "collection.activate"
    REVOKE = "collection.revoke"
    ROTATE = "collection.rotate"
    EXPIRE = "collection.expire"
    MEMBER_ADD = "collection.member_add"
    MEMBER_REMOVE = "collection.member_remove"
    MEMBER_SCOPE_CHANGE = "collection.member_scope_change"
    MEMBER_PRESET_APPLY = "collection.member_preset_apply"


class ActivityTransport(StrEnum):
    """How an owner operation reached the service."""

    MCP = "mcp"
    HTTP = "http"


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
