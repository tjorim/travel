"""Area request and response schemas."""

from pydantic import ConfigDict, Field, field_validator

from app.models import Visibility
from app.schemas.base import (
    COUNTRY_CODE_FIELD,
    DUTCH_TEXT,
    ENGLISH_TEXT,
    LOCAL_NAME,
    PLAIN_TEXT,
    InputModel,
    ResponseModel,
    TextLanguage,
    blank_to_none,
    require_timezone,
)
from app.schemas.places import PlaceReverseGeocodeRequest

from .localized import TranslationFreshness


class AreaInput(InputModel):
    """A deliberately authored area: label, country/region and an
    optional approved generalized point. Shareable, unlike a location."""

    label: str | None = Field(default=None, max_length=120, description=PLAIN_TEXT)
    label_nl: str | None = Field(default=None, max_length=120, description=DUTCH_TEXT)
    label_en: str | None = Field(default=None, max_length=120, description=ENGLISH_TEXT)
    local_name: str | None = Field(default=None, max_length=120, description=LOCAL_NAME)
    country_code: str | None = COUNTRY_CODE_FIELD
    region: str | None = Field(default=None, max_length=120)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    timezone: str | None = Field(default=None, max_length=64)

    _timezone = field_validator("timezone")(require_timezone)
    _local_name = field_validator("local_name")(blank_to_none)

    @field_validator("latitude", "longitude")
    @classmethod
    def generalize_coordinate(cls, value: float | None) -> float | None:
        return round(value, 2) if value is not None else None


class AreaUpdate(InputModel):
    label: str | None = Field(default=None, max_length=120, description=PLAIN_TEXT)
    label_nl: str | None = Field(default=None, max_length=120, description=DUTCH_TEXT)
    label_en: str | None = Field(default=None, max_length=120, description=ENGLISH_TEXT)
    label_reviewed: TextLanguage | None = Field(
        default=None, description="Confirm that this language version is still correct."
    )
    local_name: str | None = Field(default=None, max_length=120, description=LOCAL_NAME)
    country_code: str | None = COUNTRY_CODE_FIELD
    region: str | None = Field(default=None, max_length=120)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    timezone: str | None = Field(default=None, max_length=64)

    _timezone = field_validator("timezone")(require_timezone)
    _local_name = field_validator("local_name")(blank_to_none)

    @field_validator("latitude", "longitude")
    @classmethod
    def generalize_coordinate(cls, value: float | None) -> float | None:
        return round(value, 2) if value is not None else None


class AreaSuggestRequest(PlaceReverseGeocodeRequest):
    city: str | None = Field(default=None, max_length=120)


class SuggestedArea(AreaInput):
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)


class AreaSuggestion(ResponseModel):
    existing_area_id: str | None = None
    area: SuggestedArea


class AreaResponse(AreaInput):
    translation_freshness: dict[str, TranslationFreshness] = Field(default_factory=dict)
    id: str
    visibility: Visibility
    model_config = ConfigDict(from_attributes=True, extra="ignore", json_schema_serialization_defaults_required=True)
