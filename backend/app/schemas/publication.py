"""Public view and hidden share link schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models import LinkState, SurfaceState
from app.schemas.audiences import ShareScope, ShareScopeInput
from app.schemas.base import InputModel, ResponseModel
from app.schemas.exclusions import ScopeExclusions
from app.schemas.sharing_presets import PresetExceptions, SharingPresetId


class PublicProjectionStatusResponse(ResponseModel):
    revision: int
    trip_id: str
    scope: ShareScope
    surface_state: SurfaceState
    slug: str | None
    # The sharing preset last applied here, as a display label (#241): it decides nothing about what is delivered.
    applied_preset: str | None = None
    applied_preset_at: datetime | None = None
    preset_exceptions: PresetExceptions | None = Field(
        default=None, description="Null when no preset was applied. Owner-only."
    )


CREATE_WITH_PRESET = (
    "Optionally start from a sharing preset instead of the public baseline: it is applied in the same transaction, "
    "after the audience is created, through the same code and rules as the preset apply route. Absent means no "
    "preset ('same as the public page')."
)


class ShareLinkCreate(InputModel):
    label: str = Field(min_length=1, max_length=120)
    scope: ShareScopeInput = Field(default_factory=ShareScopeInput)
    preset: SharingPresetId | None = Field(default=None, description=CREATE_WITH_PRESET)


CONFIRM_EXCLUSION_WIDENING = (
    "Set to true to accept that removing exclusions from a live (active) audience shows its visitors records they "
    "did not receive. Without it such a change is refused with 409 exclusion_widening_needs_acknowledgement, which "
    "lists the records, and nothing changes. Drafts need no acknowledgement. Not stored."
)


class ShareLinkUpdate(InputModel):
    non_nullable_fields = frozenset(["label", "scope", "confirm_widening"])

    label: str | None = Field(default=None, min_length=1, max_length=120)
    scope: ShareScopeInput | None = None
    confirm_widening: bool = Field(default=False, description=CONFIRM_EXCLUSION_WIDENING)


class ShareLinkActivateRequest(InputModel):
    # `null` is an explicit owner choice for a revocable link without natural
    # expiry. Omitted retains the safer 30-day default.
    expires_in_days: int | None = Field(default=30, ge=1, le=90)
    reason: str | None = Field(default=None, max_length=500)


class FeedEnableRequest(ShareLinkActivateRequest):
    acknowledge_copies: bool = False


class ShareLinkResponse(ResponseModel):
    feed_token: str | None = None
    feed_expires_at: datetime | None = None
    revision: int
    id: str
    series_id: str
    label: str
    state: LinkState
    scope: ShareScope
    token: str | None
    expires_at: datetime | None
    created_at: datetime
    activated_at: datetime | None
    revoked_at: datetime | None
    # What this link leaves out of the public baseline and what that also hides. Filled in by the owner endpoints.
    exclusions: ScopeExclusions = Field(default_factory=ScopeExclusions)
    # The sharing preset last applied here, as a display label (#241): it decides nothing about what is delivered.
    applied_preset: str | None = None
    applied_preset_at: datetime | None = None
    preset_exceptions: PresetExceptions | None = Field(
        default=None, description="Null when no preset was applied. Owner-only."
    )
    model_config = ConfigDict(from_attributes=True)


class ShareLinkActivateResponse(ShareLinkResponse):
    pass


# MCP share-link metadata is deliberately independent of the token-bearing REST model.
class McpShareLinkResponse(BaseModel):
    id: str
    series_id: str
    label: str
    state: LinkState
    scope: ShareScope
    expires_at: datetime | None
    created_at: datetime
    activated_at: datetime | None
    revoked_at: datetime | None
    exclusions: ScopeExclusions = Field(default_factory=ScopeExclusions)
    # The sharing preset last applied here, as a display label (#241): it decides nothing about what is delivered.
    applied_preset: str | None = None
    applied_preset_at: datetime | None = None
    preset_exceptions: PresetExceptions | None = Field(
        default=None, description="Null when no preset was applied. Owner-only."
    )
    model_config = ConfigDict(from_attributes=True)
