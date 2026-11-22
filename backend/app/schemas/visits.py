"""Visit request and response schemas."""

from datetime import date, time

from pydantic import ConfigDict, Field, computed_field, model_validator
from pydantic_core import PydanticCustomError

from app.models import DatePrecision, PlanningStatus, Visibility, VisitKind
from app.schemas.areas import AreaResponse
from app.schemas.base import (
    DUTCH_TEXT,
    ENGLISH_TEXT,
    MARKDOWN,
    PLAIN_TEXT,
    PRECISION_OWN,
    Identifier,
    InputModel,
    LocalTime,
    ResponseModel,
    TextLanguage,
    _html,
    _html_of,
    require_ordered_dates,
)
from app.schemas.locations import LocationInput, LocationResponse

from .localized import TranslationFreshness


def require_visit_times(
    starts_on: date | None, ends_on: date | None, start_time: time | None, end_time: time | None
) -> None:
    """A visit's last day follows its first, and its times sit on a day, start before they end."""
    if ends_on is not None and starts_on is None:
        raise PydanticCustomError("a_last_day_needs_a_first_day", "A last day needs a first day")
    require_ordered_dates(starts_on, ends_on, "The last day cannot precede the first day")
    if start_time is not None and starts_on is None:
        raise PydanticCustomError("a_time_needs_a_day", "A time needs a day")
    if end_time is not None and start_time is None:
        raise PydanticCustomError("an_end_time_needs_a_start_time", "An end time needs a start time")
    if (
        start_time is not None
        and end_time is not None
        and (ends_on is None or ends_on == starts_on)
        and end_time <= start_time
    ):
        raise PydanticCustomError(
            "the_end_time_must_be_after_the_start_time", "The end time must be after the start time"
        )


class VisitCreate(InputModel):
    """A stop: at an area, or at a location in one, and optionally when."""

    area_id: Identifier | None = Field(default=None, min_length=1, max_length=32)
    location: LocationInput | None = None
    title: str | None = Field(default=None, max_length=160, description=PLAIN_TEXT)
    title_nl: str | None = Field(default=None, max_length=160, description=DUTCH_TEXT)
    title_en: str | None = Field(default=None, max_length=160, description=ENGLISH_TEXT)
    kind: VisitKind | None = None
    status: PlanningStatus = PlanningStatus.PLANNED
    starts_on: date | None = None
    ends_on: date | None = None
    start_time: LocalTime | None = None
    end_time: LocalTime | None = None
    notes: str | None = Field(default=None, max_length=4000, description=MARKDOWN)
    summary: str | None = Field(default=None, max_length=2000, description=MARKDOWN + " " + PLAIN_TEXT)
    summary_nl: str | None = Field(default=None, max_length=2000, description=MARKDOWN + " " + DUTCH_TEXT)
    summary_en: str | None = Field(default=None, max_length=2000, description=MARKDOWN + " " + ENGLISH_TEXT)
    share_time: bool = False
    share_date_precision: DatePrecision | None = Field(default=None, description=PRECISION_OWN)

    @model_validator(mode="after")
    def valid_visit(self):
        if self.area_id is None and self.location is None:
            raise PydanticCustomError("say_where_an_area_or_a_location", "Say where: an area or a location")
        require_visit_times(self.starts_on, self.ends_on, self.start_time, self.end_time)
        return self


class VisitUpdate(InputModel):
    non_nullable_fields = frozenset(["status", "share_time"])

    area_id: Identifier | None = Field(default=None, min_length=1, max_length=32)
    location: LocationInput | None = None
    title: str | None = Field(default=None, max_length=160, description=PLAIN_TEXT)
    title_nl: str | None = Field(default=None, max_length=160, description=DUTCH_TEXT)
    title_en: str | None = Field(default=None, max_length=160, description=ENGLISH_TEXT)
    kind: VisitKind | None = None
    status: PlanningStatus | None = None
    starts_on: date | None = None
    ends_on: date | None = None
    start_time: LocalTime | None = None
    end_time: LocalTime | None = None
    notes: str | None = Field(default=None, max_length=4000, description=MARKDOWN)
    summary: str | None = Field(default=None, max_length=2000, description=MARKDOWN + " " + PLAIN_TEXT)
    summary_nl: str | None = Field(default=None, max_length=2000, description=MARKDOWN + " " + DUTCH_TEXT)
    summary_en: str | None = Field(default=None, max_length=2000, description=MARKDOWN + " " + ENGLISH_TEXT)
    title_reviewed: TextLanguage | None = Field(
        default=None, description="Confirm that this language version is still correct."
    )
    summary_reviewed: TextLanguage | None = Field(
        default=None, description="Confirm that this language version is still correct."
    )
    share_time: bool | None = None
    share_date_precision: DatePrecision | None = Field(
        default=None, description=PRECISION_OWN + " Send null to follow the audience; omit to keep the value."
    )


class RouteReference(ResponseModel):
    id: str
    title: str


class VisitRouteCheck(InputModel):
    """A visit as it is being typed, before it is saved: enough to tell whether it restates a route."""

    area_id: Identifier | None = Field(default=None, min_length=1, max_length=32)
    location_id: Identifier | None = Field(default=None, min_length=1, max_length=32)
    title: str | None = Field(default=None, max_length=160)
    summary: str | None = Field(default=None, max_length=2000)
    starts_on: date | None = None
    ends_on: date | None = None


class VisitResponse(ResponseModel):
    translation_freshness: dict[str, TranslationFreshness] = Field(default_factory=dict)
    id: str
    area: AreaResponse
    location: LocationResponse | None
    title: str | None
    title_nl: str | None
    title_en: str | None
    kind: VisitKind | None
    status: PlanningStatus
    starts_on: date | None
    ends_on: date | None
    start_time: time | None
    end_time: time | None
    notes: str | None
    summary: str | None
    summary_nl: str | None
    summary_en: str | None
    visibility: Visibility
    share_time: bool
    share_date_precision: DatePrecision | None = Field(description=PRECISION_OWN)
    # Routes this visit probably restates (same day and area, and it is about the journey): a
    # non-blocking hint that the journey belongs in Routes. Filled in by the visits endpoints.
    possible_route_duplicates: list[RouteReference] = []
    model_config = ConfigDict(from_attributes=True)

    @computed_field(description=_html_of("notes"))
    @property
    def notes_html(self) -> str | None:
        return _html(self.notes)

    @computed_field(description=_html_of("summary"))
    @property
    def summary_html(self) -> str | None:
        return _html(self.summary)
