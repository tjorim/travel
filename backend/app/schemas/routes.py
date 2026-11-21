"""Route request and response schemas."""

from datetime import UTC, date, datetime
from typing import Literal

from pydantic import ConfigDict, Field, computed_field, field_validator, model_validator
from pydantic_core import PydanticCustomError

from app.models import PlanningStatus, RouteMode, Visibility
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
    require_timezone,
)
from app.schemas.documents import require_unique_document_ids
from app.schemas.locations import LocationInput, LocationResponse

ROUTE_STATUS = (
    "idea: a candidate being compared (two flights, a train or a bus) that covers no journey and cannot be shared; "
    "planned: the intended route; confirmed: reserved or confirmed; cancelled."
)


class GeoJsonLineString(InputModel):
    """A reviewed approximate GeoJSON line, drawn or seeded from a finished-file
    draft. Coordinates are longitude, latitude pairs; raw tracks are never stored."""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    type: Literal["LineString"] = "LineString"
    coordinates: list[tuple[float, float]] = Field(min_length=2, max_length=10_000)

    @field_validator("coordinates")
    @classmethod
    def valid_coordinates(cls, values: list[tuple[float, float]]) -> list[tuple[float, float]]:
        for longitude, latitude in values:
            if not -180 <= longitude <= 180 or not -90 <= latitude <= 90:
                raise PydanticCustomError(
                    "route_coordinates_must_be_valid_longitude_latitude_pairs",
                    "Route coordinates must be valid longitude, latitude pairs",
                )
        return values


class StoredGeoJsonLineString(GeoJsonLineString):
    """A saved line as a response reads it back, including one carried over from an older schema."""

    model_config = ConfigDict(extra="ignore", json_schema_serialization_defaults_required=True)


_DEPARTS_ON = (
    "The local day of departure (YYYY-MM-DD), in the departure time zone. Store a day without inventing a time: "
    "'Kaohsiung → Taipei on 5 December, no train yet' is departs_on alone, never a made-up departs_at. With "
    "departs_at it is derived when left out, and must equal the local date of departs_at when given."
)


def require_route_ends(model):
    """Each end of a route is an area, given directly or through a location that is filed under one."""
    for end in ("departure", "arrival"):
        if getattr(model, f"{end}_area_id") is None and getattr(model, f"{end}_location") is None:
            raise PydanticCustomError(
                "route_end_required",
                f"Say where the route {'starts' if end == 'departure' else 'ends'}: an area or a location",
            )
    return model


class RouteCreate(InputModel):
    """A route between two areas. Everything else is optional: the departure day,
    the exact locations, the schedule (both times or neither, and only with a
    day), booking details and a drawn line."""

    mode: RouteMode
    status: PlanningStatus = Field(default=PlanningStatus.PLANNED, description=ROUTE_STATUS)
    label: str | None = Field(default=None, max_length=160, description=PLAIN_TEXT)
    label_nl: str | None = Field(default=None, max_length=160, description=DUTCH_TEXT)
    label_en: str | None = Field(default=None, max_length=160, description=ENGLISH_TEXT)
    departure_area_id: Identifier | None = Field(default=None, min_length=1, max_length=32)
    arrival_area_id: Identifier | None = Field(default=None, min_length=1, max_length=32)
    departure_location: LocationInput | None = None
    arrival_location: LocationInput | None = None
    departs_on: date | None = Field(default=None, description=_DEPARTS_ON)
    # With an end's time zone, a datetime without an offset is the local
    # wall-clock time there. Without one it must carry an explicit offset.
    departs_at: datetime | None = None
    arrives_at: datetime | None = None
    departure_timezone: str | None = Field(default=None, max_length=64)
    arrival_timezone: str | None = Field(default=None, max_length=64)
    carrier: str | None = Field(default=None, max_length=160)
    service_reference: str | None = Field(default=None, max_length=40)
    travel_class: str | None = Field(default=None, max_length=80)
    booking_reference: str | None = Field(default=None, max_length=255)
    notes: str | None = Field(default=None, max_length=4000, description=MARKDOWN)
    document_asset_ids: list[Identifier] = Field(default_factory=list, max_length=12)
    geometry: GeoJsonLineString | None = None

    _timezones = field_validator("departure_timezone", "arrival_timezone")(require_timezone)
    _ends = model_validator(mode="after")(require_route_ends)

    @model_validator(mode="after")
    def times_come_as_a_pair(self):
        if (self.departs_at is None) != (self.arrives_at is None):
            raise PydanticCustomError(
                "give_both_the_departure_and_the_arrival_time_or_neither",
                "Give both the departure and the arrival time, or neither",
            )
        return self

    @field_validator("document_asset_ids")
    @classmethod
    def require_unique_documents(cls, values: list[str]) -> list[str]:
        return require_unique_document_ids(values)


class RouteUpdate(InputModel):
    non_nullable_fields = frozenset(["mode", "status", "document_asset_ids"])

    mode: RouteMode | None = None
    status: PlanningStatus | None = Field(default=None, description=ROUTE_STATUS)
    label: str | None = Field(default=None, max_length=160, description=PLAIN_TEXT)
    label_nl: str | None = Field(default=None, max_length=160, description=DUTCH_TEXT)
    label_en: str | None = Field(default=None, max_length=160, description=ENGLISH_TEXT)
    departure_area_id: Identifier | None = Field(default=None, min_length=1, max_length=32)
    arrival_area_id: Identifier | None = Field(default=None, min_length=1, max_length=32)
    departure_location: LocationInput | None = None
    arrival_location: LocationInput | None = None
    departs_on: date | None = Field(default=None, description=_DEPARTS_ON)
    departs_at: datetime | None = None
    arrives_at: datetime | None = None
    departure_timezone: str | None = Field(default=None, max_length=64)
    arrival_timezone: str | None = Field(default=None, max_length=64)
    carrier: str | None = Field(default=None, max_length=160)
    service_reference: str | None = Field(default=None, max_length=40)
    travel_class: str | None = Field(default=None, max_length=80)
    booking_reference: str | None = Field(default=None, max_length=255)
    notes: str | None = Field(default=None, max_length=4000, description=MARKDOWN)
    document_asset_ids: list[Identifier] | None = Field(default=None, max_length=12)
    geometry: GeoJsonLineString | None = None

    _timezones = field_validator("departure_timezone", "arrival_timezone")(require_timezone)

    @field_validator("document_asset_ids")
    @classmethod
    def require_unique_documents(cls, values: list[str] | None) -> list[str] | None:
        return None if values is None else require_unique_document_ids(values)


class RouteResponse(ResponseModel):
    id: str
    mode: RouteMode
    status: PlanningStatus
    label: str | None
    label_nl: str | None
    label_en: str | None
    departure_area: AreaResponse
    arrival_area: AreaResponse
    departure_location: LocationResponse | None
    arrival_location: LocationResponse | None
    departs_on: date | None
    departs_at: datetime | None
    arrives_at: datetime | None
    departure_timezone: str | None
    arrival_timezone: str | None
    carrier: str | None
    service_reference: str | None
    travel_class: str | None
    booking_reference: str | None
    notes: str | None
    document_asset_ids: list[str]
    geometry: StoredGeoJsonLineString | None
    visibility: Visibility
    model_config = ConfigDict(from_attributes=True)

    @computed_field(description=_html_of("notes"))
    @property
    def notes_html(self) -> str | None:
        return _html(self.notes)

    @field_validator("departs_at", "arrives_at")
    @classmethod
    def mark_utc(cls, value: datetime | None) -> datetime | None:
        # SQLite returns stored UTC instants without an offset; a client must
        # never read them as its own local time.
        return value if value is None or value.tzinfo is not None else value.replace(tzinfo=UTC)
