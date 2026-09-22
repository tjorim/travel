from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator

from .models import (
    DerivativePurpose,
    DerivativeReviewState,
    ImportProvider,
    ImportSessionState,
    LinkState,
    MediaKind,
    PublicationState,
    SurfaceState,
    Visibility,
)


class PlaceInput(BaseModel):
    display_name: str = Field(min_length=1, max_length=120)
    country_code: str | None = Field(default=None, min_length=2, max_length=2, pattern=r"^[A-Z]{2}$")


class PlaceResponse(PlaceInput):
    id: str
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
    place: PlaceInput
    position: int = Field(ge=0)
    label: str | None = Field(default=None, max_length=120)


class RouteStageUpdate(BaseModel):
    place: PlaceInput | None = None
    position: int | None = Field(default=None, ge=0)
    label: str | None = Field(default=None, max_length=120)


class RouteStageResponse(BaseModel):
    id: str
    position: int
    label: str | None
    place: PlaceResponse
    model_config = ConfigDict(from_attributes=True)


class MomentCreate(BaseModel):
    occurred_at: datetime
    title: str = Field(min_length=1, max_length=160)
    story: str = Field(min_length=1, max_length=10000)
    place: PlaceInput | None = None
    photo_urls: list[HttpUrl] = Field(default_factory=list, max_length=12)

    @field_validator("photo_urls")
    @classmethod
    def require_https(cls, values: list[HttpUrl]) -> list[HttpUrl]:
        if any(value.scheme != "https" for value in values):
            raise ValueError("Photo references must use HTTPS")
        return values


class MomentUpdate(BaseModel):
    occurred_at: datetime | None = None
    title: str | None = Field(default=None, min_length=1, max_length=160)
    story: str | None = Field(default=None, min_length=1, max_length=10000)
    place: PlaceInput | None = None
    photo_urls: list[HttpUrl] | None = Field(default=None, max_length=12)

    @field_validator("photo_urls")
    @classmethod
    def require_https(cls, values: list[HttpUrl] | None) -> list[HttpUrl] | None:
        if values is not None and any(value.scheme != "https" for value in values):
            raise ValueError("Photo references must use HTTPS")
        return values


class MomentResponse(BaseModel):
    id: str
    occurred_at: datetime
    title: str
    story: str
    photo_urls: list[str]
    place: PlaceResponse | None
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
    model_config = ConfigDict(from_attributes=True)


class PublicTripResponse(BaseModel):
    public_id: str
    title: str
    summary: str | None
    route_stages: list[RouteStageResponse]
    moments: list[MomentResponse]


class ShareScopeInput(BaseModel):
    """The explicit, owner-selected content of a public or unlisted view.

    Anything not listed here is absent from the rendered projection, never
    merely hidden by a client.
    """

    include_title: bool = True
    include_summary: bool = True
    route_stage_ids: list[str] = Field(default_factory=list, max_length=200)
    moment_ids: list[str] = Field(default_factory=list, max_length=200)


class ProjectionPlace(BaseModel):
    display_name: str
    country_code: str | None


class ProjectionRouteStage(BaseModel):
    id: str
    position: int
    label: str | None
    place: ProjectionPlace


class ProjectionMoment(BaseModel):
    id: str
    occurred_at: datetime
    title: str
    story: str
    photo_urls: list[str]
    place: ProjectionPlace | None


class ProjectionDocument(BaseModel):
    schema_version: str
    title: str | None
    summary: str | None
    route_stages: list[ProjectionRouteStage]
    moments: list[ProjectionMoment]


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
