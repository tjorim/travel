"""Media asset, derivative, candidate and provider import schemas."""

from datetime import datetime
from typing import Literal

from pydantic import ConfigDict, Field, computed_field, field_validator
from pydantic_core import PydanticCustomError

from app.core.markdown import render_inline
from app.models import (
    DerivativePurpose,
    DerivativeReviewState,
    ImportProvider,
    ImportSessionState,
    MediaKind,
    Visibility,
)
from app.schemas.base import (
    DUTCH_TEXT,
    ENGLISH_TEXT,
    INLINE_MARKDOWN,
    PLAIN_TEXT,
    Identifier,
    InputModel,
    ResponseModel,
    TextLanguage,
    _html_of,
)

from .localized import TranslationFreshness


class OAuthStartResponse(ResponseModel):
    authorization_url: str


# Every route here is owner-only, so surfacing a parsed EXIF convenience
# subset (capture time, camera, GPS) is fine — the owner is the one audience
# permitted to see it. What never appears, even here, is a bucket, object
# key, provider URL, or the raw EXIF/XMP/IPTC blob itself; `file_url` is
# always an audience-checked delivery route, never a direct storage
# reference. A public/unlisted response is a completely separate schema
# (the future share-scope projection) that never reuses this one.
class MediaGpsCoordinates(ResponseModel):
    latitude: float
    longitude: float


class MediaAssetResponse(ResponseModel):
    id: str
    media_kind: MediaKind
    byte_size: int
    content_type: str
    captured_at: datetime | None
    # True: captured_at is the camera's wall-clock time (UTC label is nominal) and is shown as written.
    captured_local: bool = False
    created_at: datetime
    deleted_at: datetime | None
    original_filename: str | None
    camera_make: str | None = None
    camera_model: str | None = None
    gps: MediaGpsCoordinates | None = None
    file_url: str
    thumbnail_url: str | None = None
    model_config = ConfigDict(from_attributes=True)


class MediaDerivativeResponse(ResponseModel):
    translation_freshness: dict[str, TranslationFreshness] = Field(default_factory=dict)
    id: str
    media_asset_id: str
    purpose: DerivativePurpose
    review_state: DerivativeReviewState
    processing_state: str = "ready"
    media_kind: MediaKind = MediaKind.PHOTO
    content_type: str | None = None
    byte_size: int | None = None
    duration_seconds: float | None = None
    poster_url: str | None = None
    remove_audio: bool = False
    metadata_stripped_at: datetime | None
    width: int | None
    height: int | None
    travel_update_id: str | None
    caption: str | None
    caption_nl: str | None
    caption_en: str | None
    alt_text: str | None
    alt_text_nl: str | None
    alt_text_en: str | None
    focal_x: int | None
    focal_y: int | None
    visibility: Visibility
    is_cover: bool = False
    created_at: datetime
    file_url: str
    model_config = ConfigDict(from_attributes=True)

    @computed_field(description=_html_of("caption") + " Inline elements only.")
    @property
    def caption_html(self) -> str | None:
        return render_inline(self.caption, "owner")


class MediaDerivativeCreate(InputModel):
    purpose: DerivativePurpose = DerivativePurpose.SHARE
    max_dimension: int = Field(default=1600, ge=64, le=4000)
    remove_audio: bool = False


class MediaDerivativePresentationUpdate(InputModel):
    travel_update_id: Identifier | None = None
    caption: str | None = Field(default=None, max_length=500, description=INLINE_MARKDOWN + " " + PLAIN_TEXT)
    caption_nl: str | None = Field(default=None, max_length=500, description=INLINE_MARKDOWN + " " + DUTCH_TEXT)
    caption_en: str | None = Field(default=None, max_length=500, description=INLINE_MARKDOWN + " " + ENGLISH_TEXT)
    alt_text: str | None = Field(default=None, max_length=300, description=PLAIN_TEXT)
    alt_text_nl: str | None = Field(default=None, max_length=300, description=DUTCH_TEXT)
    alt_text_en: str | None = Field(default=None, max_length=300, description=ENGLISH_TEXT)
    caption_reviewed: TextLanguage | None = Field(
        default=None, description="Confirm that this language version is still correct."
    )
    alt_text_reviewed: TextLanguage | None = Field(
        default=None, description="Confirm that this language version is still correct."
    )
    focal_x: int | None = Field(default=None, ge=0, le=100)
    focal_y: int | None = Field(default=None, ge=0, le=100)


class MediaTravelUpdateCandidatesRequest(InputModel):
    """Only assets the owner explicitly selected are eligible for review."""

    media_asset_ids: list[Identifier] = Field(min_length=1, max_length=100)

    @field_validator("media_asset_ids")
    @classmethod
    def require_unique_assets(cls, values: list[str]) -> list[str]:
        if len(values) != len(set(values)):
            raise PydanticCustomError(
                "a_media_asset_can_only_be_selected_once", "A media asset can only be selected once"
            )
        return values


class MediaTravelUpdateTimeOption(ResponseModel):
    media_asset_id: str
    captured_at: datetime
    captured_local: bool = False


class MediaTravelUpdateLocationOption(MediaGpsCoordinates):
    media_asset_ids: list[str]


class MediaTravelUpdateCandidateResponse(ResponseModel):
    id: str
    media_asset_ids: list[str]
    starts_at: datetime | None
    ends_at: datetime | None
    captured_local: bool = False
    time_options: list[MediaTravelUpdateTimeOption]
    location_options: list[MediaTravelUpdateLocationOption]


class MediaTravelUpdateCandidatesResponse(ResponseModel):
    """Ephemeral owner-only review data; it is never a published resource."""

    grouping_window_minutes: int
    gps_agreement_metres: int
    candidates: list[MediaTravelUpdateCandidateResponse]
    unavailable_media_asset_ids: list[str]


# The providers a library is imported from; a direct device upload has no session or connection.
ImportSourceProvider = Literal[ImportProvider.GOOGLE_PHOTOS_PICKER, ImportProvider.GOPRO_CLOUD]


class ImportSessionResponse(ResponseModel):
    id: str
    provider: ImportSourceProvider
    state: ImportSessionState
    picker_uri: str | None = None
    expires_at: datetime | None
    model_config = ConfigDict(from_attributes=True)


class ImportFailureItem(ResponseModel):
    provider_item_id: str
    failure_code: str


class ImportSessionCompleteResponse(ResponseModel):
    ready: bool
    imported: list[MediaAssetResponse]
    failed: list[ImportFailureItem]


class ProviderConnectionStatus(ResponseModel):
    """A deliberately non-secret view of an owner's provider connection."""

    provider: ImportSourceProvider
    # Whether this server offers the provider at all (GoPro Cloud needs beta access switched on).
    # An unavailable provider is not shown; an available one still needs the owner's token.
    available: bool
    connected: bool
