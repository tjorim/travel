"""Collection link, member and index schemas."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.core.content_language import ContentLanguage
from app.models import LinkState
from app.schemas.audiences import ShareScope, ShareScopeInput
from app.schemas.base import (
    CONTENT_LANGUAGE,
    DUTCH_TEXT,
    ENGLISH_TEXT,
    LANGUAGE_MARKER,
    PLAIN_TEXT,
    Identifier,
    InputModel,
    ResponseModel,
    TextLanguage,
)
from app.schemas.exclusions import ScopeExclusions
from app.schemas.projection import ProjectionDates
from app.schemas.publication import CREATE_WITH_PRESET
from app.schemas.sharing_presets import PresetExceptions, SharingPresetId

from .localized import TranslationFreshness


# A collection is owner-wide: its members are (trip, scope) pairs and its own
# token opens an index of them. The owner label never reaches a visitor.
class CollectionCreate(InputModel):
    content_language: ContentLanguage | None = Field(
        default=None, description=CONTENT_LANGUAGE + " Left out, it is Dutch."
    )
    label: str = Field(min_length=1, max_length=120)
    # Optional text written for visitors; without it the visitor page uses a generic heading.
    title: str | None = Field(default=None, max_length=160, description=PLAIN_TEXT)
    title_nl: str | None = Field(default=None, max_length=160, description=DUTCH_TEXT)
    title_en: str | None = Field(default=None, max_length=160, description=ENGLISH_TEXT)


class CollectionUpdate(InputModel):
    non_nullable_fields = frozenset(["label", "content_language"])

    content_language: ContentLanguage | None = Field(default=None, description=CONTENT_LANGUAGE)
    label: str | None = Field(default=None, min_length=1, max_length=120)
    title: str | None = Field(default=None, max_length=160, description=PLAIN_TEXT)
    title_nl: str | None = Field(default=None, max_length=160, description=DUTCH_TEXT)
    title_en: str | None = Field(default=None, max_length=160, description=ENGLISH_TEXT)
    title_reviewed: TextLanguage | None = Field(
        default=None, description="Confirm that this language version is still correct."
    )


class CollectionMemberCreate(InputModel):
    trip_id: Identifier
    scope: ShareScopeInput = Field(default_factory=ShareScopeInput)
    preset: SharingPresetId | None = Field(default=None, description=CREATE_WITH_PRESET)


class CollectionMemberUpdate(InputModel):
    scope: ShareScopeInput


class CollectionMemberResponse(ResponseModel):
    revision: int
    id: str
    trip_id: str
    # Owner-only: the trip's own title, whatever the member scope shares.
    trip_title: str
    scope: ShareScope
    # How many records this member delivers today; 0 means the audience sees at most the trip header.
    delivered_records: int
    exclusions: ScopeExclusions = Field(default_factory=ScopeExclusions)
    # The sharing preset last applied here, as a display label (#241): it decides nothing about what is delivered.
    applied_preset: str | None = None
    applied_preset_at: datetime | None = None
    preset_exceptions: PresetExceptions | None = Field(
        default=None, description="Null when no preset was applied. Owner-only."
    )
    created_at: datetime
    updated_at: datetime


class CollectionResponse(ResponseModel):
    translation_freshness: dict[str, TranslationFreshness] = Field(default_factory=dict)
    id: str
    label: str
    content_language: ContentLanguage
    title: str | None
    title_nl: str | None
    title_en: str | None
    state: LinkState
    token: str | None
    expires_at: datetime | None
    rotations: int
    created_at: datetime
    updated_at: datetime
    activated_at: datetime | None
    revoked_at: datetime | None
    members: list[CollectionMemberResponse]


# MCP collection metadata is deliberately independent of the token-bearing REST model.
class McpCollectionResponse(BaseModel):
    translation_freshness: dict[str, TranslationFreshness] = Field(default_factory=dict)
    id: str
    label: str
    content_language: ContentLanguage
    title: str | None
    title_nl: str | None
    title_en: str | None
    state: LinkState
    expires_at: datetime | None
    rotations: int
    created_at: datetime
    updated_at: datetime
    activated_at: datetime | None
    revoked_at: datetime | None
    members: list[CollectionMemberResponse]


class CollectionMembershipResponse(ResponseModel):
    """Which collection reaches a trip, for the owner's trip screens."""

    collection_id: str
    member_id: str
    label: str
    state: LinkState
    expires_at: datetime | None


class CollectionAuditEventResponse(ResponseModel):
    id: str
    collection_id: str
    trip_id: str | None
    kind: str
    occurred_at: datetime
    details: dict
    model_config = ConfigDict(from_attributes=True)


class CollectionIndexEntry(BaseModel):
    """One member as the audience sees it: only what the member scope allows."""

    id: str = Field(description="A collection-local opaque id for the trip page path, never the trip's own id.")
    title: str | None
    title_lang: TextLanguage | None = Field(
        default=None, exclude_if=lambda value: value is None, description=LANGUAGE_MARKER
    )
    summary_text: str | None
    summary_lang: TextLanguage | None = Field(
        default=None, exclude_if=lambda value: value is None, description=LANGUAGE_MARKER
    )
    dates: ProjectionDates | None
    cover: str | None = Field(
        description="The id of the photo the member shows as the trip's cover, served by the member's file route."
    )


class CollectionIndexDocument(ResponseModel):
    schema_version: Literal["travel/collection@1"] = "travel/collection@1"
    title: str | None
    title_lang: TextLanguage | None = Field(
        default=None, exclude_if=lambda value: value is None, description=LANGUAGE_MARKER
    )
    trips: list[CollectionIndexEntry]
