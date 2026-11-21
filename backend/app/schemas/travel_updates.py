"""Travel update (reisupdate) request and response schemas."""

from datetime import date, datetime
from typing import Any

from pydantic import ConfigDict, Field, computed_field, field_validator, model_validator
from pydantic_core import PydanticCustomError

from app.models import DatePrecision, Visibility
from app.schemas.areas import AreaResponse
from app.schemas.base import (
    DUTCH_TEXT,
    ENGLISH_TEXT,
    MARKDOWN,
    PLAIN_TEXT,
    Identifier,
    InputModel,
    ResponseModel,
    _html,
    _html_of,
)
from app.schemas.locations import LocationInput, LocationResponse


def _accept_old_date_precision(data: Any) -> Any:
    """Read the retired ``date_precision`` key of a travel update as ``share_date_precision`` (#386).

    The key was renamed so that the owner API's setting and the visitor document's delivered value no longer share a
    name. A client written before the rename keeps working for one release; a request that sends both names with
    different values is ambiguous and refused."""
    if not isinstance(data, dict) or "date_precision" not in data:
        return data
    data = dict(data)
    old = data.pop("date_precision")
    if "share_date_precision" in data and data["share_date_precision"] != old:
        raise PydanticCustomError(
            "conflicting_date_precision",
            "date_precision was renamed to share_date_precision; send only share_date_precision",
        )
    data["share_date_precision"] = old
    return data


def _require_unique_media_assets(values: list[str] | None) -> list[str] | None:
    if values is not None and len(values) != len(set(values)):
        raise PydanticCustomError("a_media_asset_can_only_be_attached_once", "A media asset can only be attached once")
    return values


class TravelUpdateCreate(InputModel):
    """A reisupdate: what happened, with a private part and a shared part.

    Private: ``private_notes``, the exact ``location`` and the attached
    ``media_asset_ids``. Shared once ``visibility`` allows it: ``title``,
    ``body`` (empty until written for visitors), the date at ``share_date_precision``
    and the ``area_id`` (an area). The retired key ``date_precision`` is read as ``share_date_precision`` for one
    release."""

    occurred_at: datetime = Field(
        description="An instant with an offset (`Z` or `+08:00`), or a wall-clock time without one, which is read in "
        "the update's zone: its area's, else the trip's nearest stay or visit, else UTC."
    )
    share_date_precision: DatePrecision = DatePrecision.DAY
    title: str | None = Field(default=None, max_length=160, description=PLAIN_TEXT)
    title_nl: str | None = Field(default=None, max_length=160, description=DUTCH_TEXT)
    title_en: str | None = Field(default=None, max_length=160, description=ENGLISH_TEXT)
    body: str | None = Field(default=None, max_length=10000, description=MARKDOWN + " " + PLAIN_TEXT)
    body_nl: str | None = Field(default=None, max_length=10000, description=MARKDOWN + " " + DUTCH_TEXT)
    body_en: str | None = Field(default=None, max_length=10000, description=MARKDOWN + " " + ENGLISH_TEXT)
    private_notes: str | None = Field(default=None, max_length=10000, description=MARKDOWN)
    area_id: Identifier | None = None
    location: LocationInput | None = None
    media_asset_ids: list[Identifier] = Field(default_factory=list, max_length=12)
    visibility: Visibility = Visibility.PRIVATE

    _old_date_precision = model_validator(mode="before")(_accept_old_date_precision)
    _unique_media = field_validator("media_asset_ids")(_require_unique_media_assets)


class TravelUpdatePatch(InputModel):
    non_nullable_fields = frozenset(["occurred_at", "visibility", "media_asset_ids"])

    occurred_at: datetime | None = Field(
        default=None,
        description="An instant with an offset, or a wall-clock time without one, read in the update's zone.",
    )
    share_date_precision: DatePrecision | None = None
    title: str | None = Field(default=None, max_length=160, description=PLAIN_TEXT)
    title_nl: str | None = Field(default=None, max_length=160, description=DUTCH_TEXT)
    title_en: str | None = Field(default=None, max_length=160, description=ENGLISH_TEXT)
    body: str | None = Field(default=None, max_length=10000, description=MARKDOWN + " " + PLAIN_TEXT)
    body_nl: str | None = Field(default=None, max_length=10000, description=MARKDOWN + " " + DUTCH_TEXT)
    body_en: str | None = Field(default=None, max_length=10000, description=MARKDOWN + " " + ENGLISH_TEXT)
    private_notes: str | None = Field(default=None, max_length=10000, description=MARKDOWN)
    area_id: Identifier | None = None
    location: LocationInput | None = None
    media_asset_ids: list[Identifier] | None = Field(default=None, max_length=12)
    visibility: Visibility | None = None

    _old_date_precision = model_validator(mode="before")(_accept_old_date_precision)
    _unique_media = field_validator("media_asset_ids")(_require_unique_media_assets)


class TravelUpdateResponse(ResponseModel):
    id: str
    occurred_at: datetime
    timezone: str = Field(
        description="The IANA zone the update's day is read in: its area's, else the zone of the trip's nearest "
        "dated stay or visit, else UTC. Read and write the time in this zone."
    )
    local_date: date = Field(description="The calendar day of `occurred_at` in `timezone`, shown to every audience.")
    share_date_precision: DatePrecision
    title: str
    title_nl: str | None
    title_en: str | None
    body: str
    body_nl: str | None
    body_en: str | None
    private_notes: str | None
    area_id: str | None
    area: AreaResponse | None
    location: LocationResponse | None
    media_asset_ids: list[str]
    visibility: Visibility
    model_config = ConfigDict(from_attributes=True)

    @computed_field(description=_html_of("body"))
    @property
    def body_html(self) -> str | None:
        return _html(self.body)

    @computed_field(description=_html_of("private_notes"))
    @property
    def private_notes_html(self) -> str | None:
        return _html(self.private_notes)
