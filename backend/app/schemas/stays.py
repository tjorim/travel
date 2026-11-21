"""Stay request and response schemas."""

from datetime import date, time

from pydantic import ConfigDict, Field, HttpUrl, computed_field, field_validator, model_validator
from pydantic_core import PydanticCustomError

from app.core.markdown import render_contact
from app.models import DatePrecision, PlanningStatus, Visibility
from app.schemas.areas import AreaResponse
from app.schemas.base import (
    MARKDOWN,
    PRECISION_OWN,
    Identifier,
    InputModel,
    LocalTime,
    ResponseModel,
    _html,
    _html_of,
    require_https,
)
from app.schemas.documents import require_unique_document_ids
from app.schemas.locations import LocationInput, LocationResponse, require_identified_location

CONTACT = (
    "Plain text, not Markdown: line breaks are kept, and phone numbers starting with + or 0 (tel), email "
    "addresses (mailto) and http(s) addresses become links."
)


STAY_STATUS = (
    "idea: a candidate being compared, which may overlap other stays, covers no night and cannot be shared; "
    "planned: the intended stay; confirmed: reserved or confirmed; cancelled."
)


STAY_DOCUMENTS = (
    "Ids of this trip's documents to attach, such as the booking confirmation (at most 12, each once). "
    "Owner-only: a document is never delivered to a visitor, whatever the stay's visibility. "
    "On an update, omit to keep the attachments; send the full list to replace them, [] to detach all."
)


STAY_DOCUMENTS_READ = "Ids of the documents attached to this stay. Owner-only; never delivered to a visitor."


def require_stay_nights(check_in_date: date, check_out_date: date) -> None:
    """A stay covers at least one night: it checks out after the day it checks in."""
    if check_out_date <= check_in_date:
        raise PydanticCustomError(
            "a_stay_covers_at_least_one_night_check_out_after_the_check_in_date",
            "A stay covers at least one night: check out after the check-in date",
        )


class StayCreate(InputModel):
    """The nights at one accommodation. ``check_out_date`` is the departure
    morning, so a stay covers the nights ``check_in_date`` up to, but not
    including, ``check_out_date``. Every stay has an area and, optionally, a
    location in it. While the accommodation is still being chosen, give only
    ``area_id``: the stay is filed under that area alone and no location is
    created. A ``location`` settles the area, so it needs no ``area_id``; when
    both are given the location must be in that area."""

    area_id: Identifier | None = Field(default=None, min_length=1, max_length=32)
    location: LocationInput | None = None
    check_in_date: date
    check_out_date: date
    check_in_time: LocalTime | None = None
    check_out_time: LocalTime | None = None
    status: PlanningStatus = Field(default=PlanningStatus.PLANNED, description=STAY_STATUS)
    property_name: str | None = Field(default=None, min_length=1, max_length=160)
    website_url: HttpUrl | None = None
    booking_reference: str | None = Field(default=None, max_length=255)
    contact_details: str | None = Field(default=None, max_length=2000, description=CONTACT)
    notes: str | None = Field(default=None, max_length=4000, description=MARKDOWN)
    document_asset_ids: list[Identifier] = Field(default_factory=list, max_length=12, description=STAY_DOCUMENTS)
    share_date_precision: DatePrecision | None = Field(default=None, description=PRECISION_OWN)

    _https = field_validator("website_url")(require_https)
    _located = field_validator("location")(require_identified_location)

    @field_validator("document_asset_ids")
    @classmethod
    def require_unique_documents(cls, values: list[str]) -> list[str]:
        return require_unique_document_ids(values)

    @model_validator(mode="after")
    def says_where(self):
        if self.location is None and self.area_id is None:
            raise PydanticCustomError(
                "say_where_this_stay_is_an_area_or_a_location", "Say where this stay is: an area, or a location"
            )
        require_stay_nights(self.check_in_date, self.check_out_date)
        return self


class StayUpdate(InputModel):
    """Change a stay. ``area_id`` alone moves it to that area and keeps its
    location only when that location is already there (otherwise the stay is
    filed under the area alone); ``location`` sets the accommodation and its
    area, and must agree with ``area_id`` when both are given; setting
    ``location`` to null keeps the area but forgets the accommodation."""

    non_nullable_fields = frozenset(["check_in_date", "check_out_date", "status", "document_asset_ids"])

    area_id: Identifier | None = Field(default=None, min_length=1, max_length=32)
    location: LocationInput | None = None
    check_in_date: date | None = None
    check_out_date: date | None = None
    check_in_time: LocalTime | None = None
    check_out_time: LocalTime | None = None
    status: PlanningStatus | None = Field(default=None, description=STAY_STATUS)
    property_name: str | None = Field(default=None, min_length=1, max_length=160)
    website_url: HttpUrl | None = None
    booking_reference: str | None = Field(default=None, max_length=255)
    contact_details: str | None = Field(default=None, max_length=2000, description=CONTACT)
    notes: str | None = Field(default=None, max_length=4000, description=MARKDOWN)
    document_asset_ids: list[Identifier] | None = Field(default=None, max_length=12, description=STAY_DOCUMENTS)
    share_date_precision: DatePrecision | None = Field(
        default=None, description=PRECISION_OWN + " Send null to follow the audience; omit to keep the value."
    )

    _https = field_validator("website_url")(require_https)
    _located = field_validator("location")(require_identified_location)

    @field_validator("document_asset_ids")
    @classmethod
    def require_unique_documents(cls, values: list[str] | None) -> list[str] | None:
        return None if values is None else require_unique_document_ids(values)


class StayResponse(ResponseModel):
    id: str
    check_in_date: date
    check_out_date: date
    check_in_time: time | None
    check_out_time: time | None
    status: PlanningStatus
    property_name: str | None
    website_url: str | None
    booking_reference: str | None
    contact_details: str | None
    notes: str | None
    document_asset_ids: list[str] = Field(description=STAY_DOCUMENTS_READ)
    location: LocationResponse | None = Field(
        description="The chosen accommodation; null while the stay is filed under its area alone."
    )
    area: AreaResponse
    visibility: Visibility
    share_date_precision: DatePrecision | None = Field(description=PRECISION_OWN)
    model_config = ConfigDict(from_attributes=True)

    @computed_field(description=_html_of("notes"))
    @property
    def notes_html(self) -> str | None:
        return _html(self.notes)

    @computed_field(
        description="Sanitized HTML of `contact_details`, with its phone numbers, email and web addresses "
        "linked; null without text. Read-only."
    )
    @property
    def contact_details_html(self) -> str | None:
        return render_contact(self.contact_details, "owner")
