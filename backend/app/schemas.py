from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator

from .models import (
    AuditEventKind,
    AuditTargetType,
    DatePrecision,
    DerivativePurpose,
    DerivativeReviewState,
    DocumentKind,
    ImportProvider,
    ImportSessionState,
    LinkState,
    MediaKind,
    PlaceKind,
    PublicationState,
    StayStatus,
    SurfaceState,
    TrackKind,
    Visibility,
)

COUNTRY_CODE_FIELD = Field(default=None, min_length=2, max_length=2, pattern=r"^[A-Z]{2}$")


class ExactPlaceInput(BaseModel):
    """An owner-only exact place: address parts, coordinates, viewport and
    navigation/provider IDs. Never appears in a public/unlisted response."""

    osm_element_type: Literal["node", "way", "relation"] | None = None
    osm_element_id: str | None = Field(default=None, min_length=1, max_length=32, pattern=r"^[0-9]+$")
    # A snapshot selected by the owner, not a live provider lookup.  It keeps
    # a saved place recognizable if provider labels later change.
    display_name: str | None = Field(default=None, max_length=500)
    address_line1: str | None = Field(default=None, max_length=160)
    address_line2: str | None = Field(default=None, max_length=160)
    locality: str | None = Field(default=None, max_length=120)
    admin_area: str | None = Field(default=None, max_length=120)
    postal_code: str | None = Field(default=None, max_length=20)
    country_code: str | None = COUNTRY_CODE_FIELD
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    viewport_north: float | None = Field(default=None, ge=-90, le=90)
    viewport_south: float | None = Field(default=None, ge=-90, le=90)
    viewport_east: float | None = Field(default=None, ge=-180, le=180)
    viewport_west: float | None = Field(default=None, ge=-180, le=180)
    navigation_provider: str | None = Field(default=None, max_length=40)
    navigation_provider_place_id: str | None = Field(default=None, max_length=255)
    notes: str | None = Field(default=None, max_length=2000)

    @field_validator("osm_element_id")
    @classmethod
    def require_osm_id_type_pair(cls, value: str | None, info):
        osm_type = info.data.get("osm_element_type")
        if (value is None) != (osm_type is None):
            raise ValueError("osm_element_type and osm_element_id must be supplied together")
        return value


class ExactPlaceResponse(ExactPlaceInput):
    id: str
    kind: Literal[PlaceKind.EXACT] = PlaceKind.EXACT
    model_config = ConfigDict(from_attributes=True)


class PlaceSearchRequest(BaseModel):
    query: str = Field(min_length=2, max_length=200)


class PlaceReverseGeocodeRequest(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class PlaceSearchResult(BaseModel):
    osm_element_type: Literal["node", "way", "relation"]
    osm_element_id: str
    display_name: str
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    address_line1: str | None = None
    address_line2: str | None = None
    locality: str | None = None
    admin_area: str | None = None
    postal_code: str | None = None
    country_code: str | None = COUNTRY_CODE_FIELD
    viewport_north: float | None = Field(default=None, ge=-90, le=90)
    viewport_south: float | None = Field(default=None, ge=-90, le=90)
    viewport_east: float | None = Field(default=None, ge=-180, le=180)
    viewport_west: float | None = Field(default=None, ge=-180, le=180)


class PlaceSearchResponse(BaseModel):
    provider: str
    attribution: str
    attribution_url: str
    results: list[PlaceSearchResult]


class NavigationResponse(BaseModel):
    """Only returned to the owner. Shared navigation redirects directly."""

    url: str
    exact: bool


class BroadPlaceInput(BaseModel):
    """A deliberately authored broad place: label, country/region and an
    optional approved generalized point. Shareable, unlike an exact place."""

    label: str = Field(min_length=1, max_length=120)
    country_code: str | None = COUNTRY_CODE_FIELD
    region: str | None = Field(default=None, max_length=120)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)


class BroadPlaceResponse(BroadPlaceInput):
    id: str
    kind: Literal[PlaceKind.BROAD] = PlaceKind.BROAD
    model_config = ConfigDict(from_attributes=True)


class TripCreate(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    summary: str | None = Field(default=None, max_length=4000)


class TripUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    summary: str | None = Field(default=None, max_length=4000)
    visibility: Visibility | None = None
    publication_state: PublicationState | None = None


class RouteStageCreate(BaseModel):
    # A caller can deliberately author a new broad place with the stage, or
    # select a previously authored one. Exact places are never accepted here.
    place: BroadPlaceInput | None = None
    broad_place_id: str | None = Field(default=None, min_length=1, max_length=32)
    position: int = Field(ge=0)
    label: str | None = Field(default=None, max_length=120)

    @model_validator(mode="after")
    def require_one_broad_place(self):
        if (self.place is None) == (self.broad_place_id is None):
            raise ValueError("Supply exactly one of place or broad_place_id")
        return self


class RouteStageUpdate(BaseModel):
    place: BroadPlaceInput | None = None
    broad_place_id: str | None = Field(default=None, min_length=1, max_length=32)
    position: int | None = Field(default=None, ge=0)
    label: str | None = Field(default=None, max_length=120)

    @model_validator(mode="after")
    def do_not_mix_broad_place_inputs(self):
        if self.place is not None and self.broad_place_id is not None:
            raise ValueError("Supply place or broad_place_id, not both")
        return self


class RouteStageResponse(BaseModel):
    id: str
    position: int
    label: str | None
    place: BroadPlaceResponse
    model_config = ConfigDict(from_attributes=True)


class MomentCreate(BaseModel):
    occurred_at: datetime
    title: str = Field(min_length=1, max_length=160)
    story: str = Field(min_length=1, max_length=10000)
    place: ExactPlaceInput | None = None
    photo_urls: list[HttpUrl] = Field(default_factory=list, max_length=12)
    media_asset_ids: list[str] = Field(default_factory=list, max_length=12)

    @field_validator("photo_urls")
    @classmethod
    def require_https(cls, values: list[HttpUrl]) -> list[HttpUrl]:
        if any(value.scheme != "https" for value in values):
            raise ValueError("Photo references must use HTTPS")
        return values

    @field_validator("media_asset_ids")
    @classmethod
    def require_unique_media_assets(cls, values: list[str]) -> list[str]:
        if len(values) != len(set(values)):
            raise ValueError("A media asset can only be attached once")
        return values


class MomentUpdate(BaseModel):
    occurred_at: datetime | None = None
    title: str | None = Field(default=None, min_length=1, max_length=160)
    story: str | None = Field(default=None, min_length=1, max_length=10000)
    place: ExactPlaceInput | None = None
    photo_urls: list[HttpUrl] | None = Field(default=None, max_length=12)
    media_asset_ids: list[str] | None = Field(default=None, max_length=12)

    @field_validator("photo_urls")
    @classmethod
    def require_https(cls, values: list[HttpUrl] | None) -> list[HttpUrl] | None:
        if values is not None and any(value.scheme != "https" for value in values):
            raise ValueError("Photo references must use HTTPS")
        return values

    @field_validator("media_asset_ids")
    @classmethod
    def require_unique_media_assets(cls, values: list[str] | None) -> list[str] | None:
        if values is not None and len(values) != len(set(values)):
            raise ValueError("A media asset can only be attached once")
        return values


class MomentResponse(BaseModel):
    id: str
    occurred_at: datetime
    title: str
    story: str
    photo_urls: list[str]
    media_asset_ids: list[str]
    place: ExactPlaceResponse | None
    model_config = ConfigDict(from_attributes=True)


class MomentExcerptCreate(BaseModel):
    source_moment_id: str | None = None
    broad_place_id: str | None = None
    date_precision: DatePrecision
    title: str = Field(min_length=1, max_length=160)
    body: str = Field(min_length=1, max_length=10000)


class MomentExcerptUpdate(BaseModel):
    source_moment_id: str | None = None
    broad_place_id: str | None = None
    date_precision: DatePrecision | None = None
    title: str | None = Field(default=None, min_length=1, max_length=160)
    body: str | None = Field(default=None, min_length=1, max_length=10000)


class MomentExcerptResponse(BaseModel):
    id: str
    source_moment_id: str | None
    broad_place_id: str | None
    date_precision: DatePrecision
    title: str
    body: str
    model_config = ConfigDict(from_attributes=True)


class StayCreate(BaseModel):
    place: ExactPlaceInput
    arrives_at: datetime
    departs_at: datetime
    status: StayStatus = StayStatus.PLANNED
    property_name: str = Field(min_length=1, max_length=160)
    booking_reference: str | None = Field(default=None, max_length=255)
    contact_details: str | None = Field(default=None, max_length=2000)
    notes: str | None = Field(default=None, max_length=4000)


class StayUpdate(BaseModel):
    place: ExactPlaceInput | None = None
    arrives_at: datetime | None = None
    departs_at: datetime | None = None
    status: StayStatus | None = None
    property_name: str | None = Field(default=None, min_length=1, max_length=160)
    booking_reference: str | None = Field(default=None, max_length=255)
    contact_details: str | None = Field(default=None, max_length=2000)
    notes: str | None = Field(default=None, max_length=4000)


class StayResponse(BaseModel):
    id: str
    arrives_at: datetime
    departs_at: datetime
    status: StayStatus
    property_name: str
    booking_reference: str | None
    contact_details: str | None
    notes: str | None
    place: ExactPlaceResponse
    model_config = ConfigDict(from_attributes=True)


class BroadStayCardCreate(BaseModel):
    broad_place_id: str
    title: str = Field(min_length=1, max_length=160)
    date_precision: DatePrecision


class BroadStayCardUpdate(BaseModel):
    broad_place_id: str | None = None
    title: str | None = Field(default=None, min_length=1, max_length=160)
    date_precision: DatePrecision | None = None


class BroadStayCardResponse(BaseModel):
    id: str
    title: str
    date_precision: DatePrecision
    place: BroadPlaceResponse
    model_config = ConfigDict(from_attributes=True)


class GeoJsonLineString(BaseModel):
    """A reviewed GeoJSON line, entered by the owner rather than computed
    from a raw recording. Coordinates are longitude, latitude pairs."""

    type: Literal["LineString"] = "LineString"
    coordinates: list[tuple[float, float]] = Field(min_length=2, max_length=10_000)

    @field_validator("coordinates")
    @classmethod
    def valid_coordinates(cls, values: list[tuple[float, float]]) -> list[tuple[float, float]]:
        for longitude, latitude in values:
            if not -180 <= longitude <= 180 or not -90 <= latitude <= 90:
                raise ValueError("Route coordinates must be valid longitude, latitude pairs")
        return values


class BroadRouteCreate(BaseModel):
    label: str = Field(min_length=1, max_length=160)
    geometry: GeoJsonLineString
    date_precision: DatePrecision


class BroadRouteUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=160)
    geometry: GeoJsonLineString | None = None
    date_precision: DatePrecision | None = None


class BroadRouteResponse(BaseModel):
    id: str
    label: str
    geometry: GeoJsonLineString
    date_precision: DatePrecision
    model_config = ConfigDict(from_attributes=True)


class RecordedTrackResponse(BaseModel):
    """Owner-only metadata and an authenticated route to raw track bytes."""

    id: str
    source_object_id: str
    started_at: datetime
    ended_at: datetime
    kind: TrackKind
    byte_size: int
    content_type: str
    source_file_url: str
    model_config = ConfigDict(from_attributes=True)


class TripResponse(BaseModel):
    id: str
    owner_subject: str
    title: str
    summary: str | None
    visibility: Visibility
    publication_state: PublicationState
    public_id: str | None
    route_stages: list[RouteStageResponse]
    moments: list[MomentResponse]
    moment_excerpts: list[MomentExcerptResponse]
    model_config = ConfigDict(from_attributes=True)


class ShareScopeKind(StrEnum):
    EXACT_PLACE = "exact_place"
    ROUTE_STAGE = "route_stage"
    BROAD_PLACE = "broad_place"
    BROAD_ROUTE = "broad_route"
    MOMENT_EXCERPT = "moment_excerpt"
    BROAD_STAY_CARD = "broad_stay_card"
    MEDIA_DERIVATIVE = "media_derivative"
    DOCUMENT_DERIVATIVE = "document_derivative"


class ShareScopeTripInput(BaseModel):
    """The small, explicit trip-level portion of a shared view."""

    title: bool = True
    summary: bool = True

    model_config = ConfigDict(extra="forbid")


class ShareScopeItemInput(BaseModel):
    """One explicitly selected share-safe resource and its output fields."""

    kind: ShareScopeKind
    id: str = Field(min_length=1, max_length=32)
    fields: list[str] = Field(default_factory=list, max_length=20)

    model_config = ConfigDict(extra="forbid")


class ShareScopeInput(BaseModel):
    """The explicit, owner-selected content of a public or unlisted view.

    Anything not listed here is absent from the rendered projection, never
    merely hidden by a client.
    """

    schema_version: Literal["travel/share-scope@1"] = "travel/share-scope@1"
    trip: ShareScopeTripInput = Field(default_factory=ShareScopeTripInput)
    items: list[ShareScopeItemInput] = Field(default_factory=list, max_length=200)

    model_config = ConfigDict(extra="forbid")


class ProjectionDocument(BaseModel):
    schema_version: str
    title: str | None
    summary: str | None
    route_stages: list[dict]
    places: list[dict]
    moments: list[dict]
    stays: list[dict]
    media: list[dict]
    documents: list[dict]
    route: list[dict]
    navigation: list[dict]


class PublicProjectionStatusResponse(BaseModel):
    trip_id: str
    scope: dict
    surface_state: SurfaceState
    slug: str | None


class ShareLinkCreate(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    scope: ShareScopeInput = Field(default_factory=ShareScopeInput)


class ShareLinkUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=120)
    scope: ShareScopeInput | None = None


class ShareLinkActivateRequest(BaseModel):
    expires_in_days: int = Field(default=30, ge=1, le=90)
    reason: str | None = Field(default=None, max_length=500)


class ShareLinkResponse(BaseModel):
    id: str
    label: str
    state: LinkState
    scope: dict
    expires_at: datetime | None
    created_at: datetime
    activated_at: datetime | None
    revoked_at: datetime | None
    model_config = ConfigDict(from_attributes=True)


class ShareLinkActivateResponse(ShareLinkResponse):
    token: str


class AuditReasonInput(BaseModel):
    """An optional owner-entered reason attached to a lifecycle-transition
    audit event; never required, since most transitions are self-explanatory."""

    reason: str | None = Field(default=None, max_length=500)


class AuditEventResponse(BaseModel):
    id: str
    kind: AuditEventKind
    target_type: AuditTargetType
    target_id: str
    occurred_at: datetime
    details: dict
    model_config = ConfigDict(from_attributes=True)


# --- Media ingestion -----------------------------------------------------------------
#
# Every route here is owner-only, so surfacing a parsed EXIF convenience
# subset (capture time, camera, GPS) is fine — the owner is the one audience
# permitted to see it. What never appears, even here, is a bucket, object
# key, provider URL, or the raw EXIF/XMP/IPTC blob itself; `file_url` is
# always an audience-checked delivery route, never a direct storage
# reference. A public/unlisted response is a completely separate schema
# (the future share-scope projection) that never reuses this one.


class MediaGpsCoordinates(BaseModel):
    latitude: float
    longitude: float


class MediaAssetResponse(BaseModel):
    id: str
    media_kind: MediaKind
    byte_size: int
    content_type: str
    captured_at: datetime | None
    created_at: datetime
    deleted_at: datetime | None
    original_filename: str | None
    camera_make: str | None = None
    camera_model: str | None = None
    gps: MediaGpsCoordinates | None = None
    file_url: str
    model_config = ConfigDict(from_attributes=True)


class MediaDerivativeResponse(BaseModel):
    id: str
    media_asset_id: str
    purpose: DerivativePurpose
    review_state: DerivativeReviewState
    metadata_stripped_at: datetime | None
    width: int | None
    height: int | None
    created_at: datetime
    file_url: str
    model_config = ConfigDict(from_attributes=True)


class MediaDerivativeCreate(BaseModel):
    purpose: DerivativePurpose = DerivativePurpose.SHARE
    max_dimension: int = Field(default=1600, ge=64, le=4000)


class MediaVisitCandidatesRequest(BaseModel):
    """Only assets the owner explicitly selected are eligible for review."""

    media_asset_ids: list[str] = Field(min_length=1, max_length=100)

    @field_validator("media_asset_ids")
    @classmethod
    def require_unique_assets(cls, values: list[str]) -> list[str]:
        if len(values) != len(set(values)):
            raise ValueError("A media asset can only be selected once")
        return values


class MediaVisitTimeOption(BaseModel):
    media_asset_id: str
    captured_at: datetime


class MediaVisitLocationOption(MediaGpsCoordinates):
    media_asset_ids: list[str]


class MediaVisitCandidateResponse(BaseModel):
    id: str
    media_asset_ids: list[str]
    starts_at: datetime | None
    ends_at: datetime | None
    time_options: list[MediaVisitTimeOption]
    location_options: list[MediaVisitLocationOption]


class MediaVisitCandidatesResponse(BaseModel):
    """Ephemeral owner-only review data; it is never a published resource."""

    grouping_window_minutes: int
    gps_agreement_metres: int
    candidates: list[MediaVisitCandidateResponse]
    unavailable_media_asset_ids: list[str]


# --- Owner-managed documents --------------------------------------------------------


class DocumentAssetResponse(BaseModel):
    id: str
    document_kind: DocumentKind
    title: str
    byte_size: int
    content_type: str
    original_filename: str | None
    created_at: datetime
    deleted_at: datetime | None
    file_url: str
    model_config = ConfigDict(from_attributes=True)


class DocumentDerivativeResponse(BaseModel):
    id: str
    document_asset_id: str
    review_state: DerivativeReviewState
    byte_size: int
    content_type: str
    created_at: datetime
    file_url: str
    model_config = ConfigDict(from_attributes=True)


class ImportSessionResponse(BaseModel):
    id: str
    provider: ImportProvider
    state: ImportSessionState
    picker_uri: str | None = None
    expires_at: datetime | None
    model_config = ConfigDict(from_attributes=True)


class ImportFailureItem(BaseModel):
    provider_item_id: str
    failure_code: str


class ImportSessionCompleteResponse(BaseModel):
    ready: bool
    imported: list[MediaAssetResponse]
    failed: list[ImportFailureItem]


class ProviderTokenSet(BaseModel):
    access_token: str = Field(min_length=1, max_length=4096)


class ProviderConnectionStatus(BaseModel):
    """A deliberately non-secret view of an owner's provider connection."""

    provider: ImportProvider
    connected: bool
