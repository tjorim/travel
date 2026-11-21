"""SQLAlchemy ORM models, one module per domain.

Every module is imported here so that ``Base.metadata`` (Alembic's ``target_metadata``) and the mapper
registry see every table; ``from app.models import X`` keeps working through the re-exports below."""

from app.models.alternatives import AlternativeGroup, AlternativeGroupMember
from app.models.areas import Area
from app.models.audit import AuditEvent, OwnerActivityEvent
from app.models.base import INTEGER_MAX, opaque_id
from app.models.collections import Collection, CollectionAuditEvent, CollectionMember
from app.models.documents import DocumentAsset
from app.models.emergency_info import EmergencyInfoEntry
from app.models.enums import (
    LIVE_DELAYS,
    ActivityTransport,
    AlternativeGroupKind,
    AuditEventKind,
    AuditTargetType,
    CollectionAuditKind,
    DatePrecision,
    DerivativeProcessingBackend,
    DerivativeProcessingState,
    DerivativePurpose,
    DerivativeReviewState,
    DocumentKind,
    EmergencyInfoKind,
    ImportProvider,
    ImportSessionState,
    ImportState,
    LinkState,
    LiveAudienceKind,
    LivePrecision,
    MediaKind,
    ObjectState,
    PlanningStatus,
    ProviderSecret,
    RouteMode,
    SurfaceState,
    TaskAlertKind,
    Visibility,
    VisitKind,
)
from app.models.live_location import LivePoint, LiveSession, LiveSessionAudience
from app.models.locations import Location
from app.models.media import ImportRecord, ImportSession, MediaAsset, MediaDerivative, MediaWorkerJob
from app.models.packing import PackingBag, PackingItem, PackingList, PackingTemplate
from app.models.routes import ROUTE_ORDER, Route, RouteDocumentAsset
from app.models.sharing import PublicSurface, ShareLink
from app.models.stays import STAY_ORDER, Stay, StayDocumentAsset
from app.models.storage import StoredObject
from app.models.tasks import TASK_ORDER, TripTask, TripTaskAlert
from app.models.travel_updates import TRAVEL_UPDATE_ORDER, TravelUpdate, TravelUpdateMediaAsset, travel_update_order_key
from app.models.trips import Trip, cover_file_route
from app.models.visits import VISIT_ORDER, Visit, visit_order_key

__all__ = [
    "ActivityTransport",
    "AlternativeGroup",
    "AlternativeGroupKind",
    "AlternativeGroupMember",
    "Area",
    "AuditEvent",
    "AuditEventKind",
    "AuditTargetType",
    "Collection",
    "CollectionAuditEvent",
    "CollectionAuditKind",
    "CollectionMember",
    "DatePrecision",
    "DerivativeProcessingBackend",
    "DerivativeProcessingState",
    "DerivativePurpose",
    "DerivativeReviewState",
    "DocumentAsset",
    "DocumentKind",
    "EmergencyInfoEntry",
    "EmergencyInfoKind",
    "INTEGER_MAX",
    "ImportProvider",
    "ImportRecord",
    "ImportSession",
    "ImportSessionState",
    "ImportState",
    "LIVE_DELAYS",
    "LinkState",
    "LiveAudienceKind",
    "LivePoint",
    "LivePrecision",
    "LiveSession",
    "LiveSessionAudience",
    "Location",
    "MediaAsset",
    "MediaDerivative",
    "MediaKind",
    "MediaWorkerJob",
    "ObjectState",
    "OwnerActivityEvent",
    "PackingBag",
    "PackingItem",
    "PackingList",
    "PackingTemplate",
    "PlanningStatus",
    "ProviderSecret",
    "PublicSurface",
    "ROUTE_ORDER",
    "Route",
    "RouteDocumentAsset",
    "RouteMode",
    "STAY_ORDER",
    "ShareLink",
    "Stay",
    "StayDocumentAsset",
    "StoredObject",
    "SurfaceState",
    "TASK_ORDER",
    "TRAVEL_UPDATE_ORDER",
    "TaskAlertKind",
    "TravelUpdate",
    "TravelUpdateMediaAsset",
    "Trip",
    "TripTask",
    "TripTaskAlert",
    "VISIT_ORDER",
    "Visibility",
    "Visit",
    "VisitKind",
    "cover_file_route",
    "opaque_id",
    "travel_update_order_key",
    "visit_order_key",
]
