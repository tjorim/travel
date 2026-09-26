from datetime import UTC, date, datetime, time
from enum import StrEnum
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator

from .models import (
    AuditEventKind,
    AuditTargetType,
    DatePrecision,
    DerivativePurpose,
    DerivativeReviewState,
    DocumentKind,
    EmergencyInfoKind,
    ImportProvider,
    ImportSessionState,
    LinkState,
    MediaKind,
    RouteMode,
    RouteStatus,
    StayStatus,
    SurfaceState,
    Visibility,
    VisitKind,
)

COUNTRY_CODE_FIELD = Field(default=None, min_length=2, max_length=2, pattern=r"^[A-Z]{2}$")


def require_https(value: HttpUrl | None) -> HttpUrl | None:
    if value is not None and value.scheme != "https":
        raise ValueError("Links must use HTTPS")
    return value


def require_timezone(value: str | None) -> str | None:
    """Accept only a known IANA zone name such as ``Asia/Taipei``."""
    if value is None:
        return value
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError) as error:
        raise ValueError("Unknown time zone") from error
    return value


def require_ordered_dates(start: date | None, end: date | None, message: str) -> None:
    if start is not None and end is not None and end < start:
        raise ValueError(message)


class LocationFields(BaseModel):
    """An owner-only location: address parts, coordinates, viewport and
    navigation/provider IDs. A shared location shows only what its allowlist says."""

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
    # The name a shared location goes by. Owner-only until the place is shared,
    # and required for that: the display name usually contains the address.
    label: str | None = Field(default=None, min_length=1, max_length=120)
    # The area the location belongs to. Left out, it is derived from the location's city.
    area_id: str | None = Field(default=None, min_length=1, max_length=32)
    # Show the address too when the location is shared. Off unless the owner chooses it.
    share_address: bool = False

    @field_validator("osm_element_id")
    @classmethod
    def require_osm_id_type_pair(cls, value: str | None, info):
        osm_type = info.data.get("osm_element_type")
        if (value is None) != (osm_type is None):
            raise ValueError("osm_element_type and osm_element_id must be supplied together")
        return value


class LocationInput(LocationFields):
    """A location to create, or, with ``existing_location_id``, a location the trip already has.

    Reusing a location keeps one "Brussels Airport" for the outbound and the return
    route. It replaces creating a copy, so nothing else may be supplied with it."""

    existing_location_id: str | None = Field(default=None, min_length=1, max_length=32)
    new_area: "AreaInput | None" = None

    @model_validator(mode="after")
    def reuse_supplies_nothing_else(self):
        if self.existing_location_id is not None and self.model_fields_set - {"existing_location_id"}:
            raise ValueError("Supply an existing location on its own, without other location fields")
        if self.new_area is not None and self.area_id is not None:
            raise ValueError("Choose an existing area or a new area")
        return self


def require_identified_location(location: "LocationInput | None") -> "LocationInput | None":
    """A stay's location must say where it is: a saved location, a name or address, a city or an area."""
    if location is None or location.existing_location_id is not None:
        return location
    located = location.latitude is not None and location.longitude is not None
    if not (located or location.display_name or location.address_line1 or location.locality or location.admin_area or location.area_id):
        raise ValueError("Say where this stay is: choose a saved location, or fill in an address, a city or an area")
    return location


class LocationUpdate(BaseModel):
    """What an existing location lets the owner change: its public name, its area
    and whether its address is shown when it is shared."""

    label: str | None = Field(default=None, min_length=1, max_length=120)
    area_id: str | None = Field(default=None, min_length=1, max_length=32)
    share_address: bool | None = None


class LocationResponse(LocationFields):
    id: str
    visibility: Visibility
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


class AreaInput(BaseModel):
    """A deliberately authored area: label, country/region and an
    optional approved generalized point. Shareable, unlike a location."""

    label: str = Field(min_length=1, max_length=120)
    country_code: str | None = COUNTRY_CODE_FIELD
    region: str | None = Field(default=None, max_length=120)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    timezone: str | None = Field(default=None, max_length=64)

    _timezone = field_validator("timezone")(require_timezone)

    @field_validator("latitude", "longitude")
    @classmethod
    def generalize_coordinate(cls, value: float | None) -> float | None:
        return round(value, 2) if value is not None else None


class AreaUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=120)
    country_code: str | None = COUNTRY_CODE_FIELD
    region: str | None = Field(default=None, max_length=120)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    timezone: str | None = Field(default=None, max_length=64)

    _timezone = field_validator("timezone")(require_timezone)

    @field_validator("latitude", "longitude")
    @classmethod
    def generalize_coordinate(cls, value: float | None) -> float | None:
        return round(value, 2) if value is not None else None


class AreaSuggestRequest(PlaceReverseGeocodeRequest):
    city: str | None = Field(default=None, max_length=120)


class AreaSuggestion(BaseModel):
    existing_area_id: str | None = None
    area: AreaInput


class AreaResponse(AreaInput):
    id: str
    visibility: Visibility
    model_config = ConfigDict(from_attributes=True)


class TripCreate(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    summary: str | None = Field(default=None, max_length=4000)
    starts_on: date | None = None
    ends_on: date | None = None
    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def end_not_before_start(self):
        require_ordered_dates(self.starts_on, self.ends_on, "The trip cannot end before it starts")
        return self


class TripUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    summary: str | None = Field(default=None, max_length=4000)
    starts_on: date | None = None
    ends_on: date | None = None
    model_config = ConfigDict(extra="forbid")


def _require_unique_media_assets(values: list[str] | None) -> list[str] | None:
    if values is not None and len(values) != len(set(values)):
        raise ValueError("A media asset can only be attached once")
    return values


class TravelUpdateCreate(BaseModel):
    """A reisupdate: what happened, with a private part and a shared part.

    Private: ``private_notes``, the exact ``location`` and the attached
    ``media_asset_ids``. Shared once ``visibility`` allows it: ``title``,
    ``body`` (empty until written for visitors), the date at ``date_precision``
    and the ``area_id`` (an area)."""

    occurred_at: datetime
    date_precision: DatePrecision = DatePrecision.DAY
    title: str = Field(min_length=1, max_length=160)
    body: str = Field(default="", max_length=10000)
    private_notes: str | None = Field(default=None, max_length=10000)
    area_id: str | None = None
    location: LocationInput | None = None
    media_asset_ids: list[str] = Field(default_factory=list, max_length=12)
    visibility: Visibility = Visibility.PRIVATE

    _unique_media = field_validator("media_asset_ids")(_require_unique_media_assets)


class TravelUpdatePatch(BaseModel):
    occurred_at: datetime | None = None
    date_precision: DatePrecision | None = None
    title: str | None = Field(default=None, min_length=1, max_length=160)
    body: str | None = Field(default=None, max_length=10000)
    private_notes: str | None = Field(default=None, max_length=10000)
    area_id: str | None = None
    location: LocationInput | None = None
    media_asset_ids: list[str] | None = Field(default=None, max_length=12)
    visibility: Visibility | None = None

    _unique_media = field_validator("media_asset_ids")(_require_unique_media_assets)


class TravelUpdateResponse(BaseModel):
    id: str
    occurred_at: datetime
    date_precision: DatePrecision
    title: str
    body: str
    private_notes: str | None
    area_id: str | None
    area: AreaResponse | None
    location: LocationResponse | None
    media_asset_ids: list[str]
    visibility: Visibility
    model_config = ConfigDict(from_attributes=True)


class StayCreate(BaseModel):
    """The nights at one accommodation. ``check_out_date`` is the departure
    morning, so a stay covers the nights ``check_in_date`` up to, but not
    including, ``check_out_date``. Every stay needs a location; the property
    name is optional while the accommodation is still being chosen."""

    location: LocationInput
    check_in_date: date
    check_out_date: date
    check_in_time: time | None = None
    check_out_time: time | None = None
    status: StayStatus = StayStatus.PLANNED
    property_name: str | None = Field(default=None, min_length=1, max_length=160)
    website_url: HttpUrl | None = None
    booking_reference: str | None = Field(default=None, max_length=255)
    contact_details: str | None = Field(default=None, max_length=2000)
    notes: str | None = Field(default=None, max_length=4000)
    share_date_precision: DatePrecision = DatePrecision.MONTH

    _https = field_validator("website_url")(require_https)
    _located = field_validator("location")(require_identified_location)


class StayUpdate(BaseModel):
    location: LocationInput | None = None
    check_in_date: date | None = None
    check_out_date: date | None = None
    check_in_time: time | None = None
    check_out_time: time | None = None
    status: StayStatus | None = None
    property_name: str | None = Field(default=None, min_length=1, max_length=160)
    website_url: HttpUrl | None = None
    booking_reference: str | None = Field(default=None, max_length=255)
    contact_details: str | None = Field(default=None, max_length=2000)
    notes: str | None = Field(default=None, max_length=4000)
    share_date_precision: DatePrecision | None = None

    _https = field_validator("website_url")(require_https)
    _located = field_validator("location")(require_identified_location)


class StayResponse(BaseModel):
    id: str
    check_in_date: date
    check_out_date: date
    check_in_time: time | None
    check_out_time: time | None
    status: StayStatus
    property_name: str | None
    website_url: str | None
    booking_reference: str | None
    contact_details: str | None
    notes: str | None
    location: LocationResponse
    area: AreaResponse
    visibility: Visibility
    share_date_precision: DatePrecision
    model_config = ConfigDict(from_attributes=True)


def require_visit_times(starts_on: date | None, ends_on: date | None, start_time: time | None, end_time: time | None) -> None:
    """A visit's last day follows its first, and its times sit on a day, start before they end."""
    if ends_on is not None and starts_on is None:
        raise ValueError("A last day needs a first day")
    require_ordered_dates(starts_on, ends_on, "The last day cannot precede the first day")
    if start_time is not None and starts_on is None:
        raise ValueError("A time needs a day")
    if end_time is not None and start_time is None:
        raise ValueError("An end time needs a start time")
    if start_time is not None and end_time is not None and (ends_on is None or ends_on == starts_on) and end_time <= start_time:
        raise ValueError("The end time must be after the start time")


class VisitCreate(BaseModel):
    """A stop: at an area, or at a location in one, and optionally when."""

    area_id: str | None = Field(default=None, min_length=1, max_length=32)
    location: LocationInput | None = None
    position: int | None = Field(default=None, ge=0)
    title: str | None = Field(default=None, min_length=1, max_length=160)
    kind: VisitKind | None = None
    starts_on: date | None = None
    ends_on: date | None = None
    start_time: time | None = None
    end_time: time | None = None
    notes: str | None = Field(default=None, max_length=4000)
    summary: str | None = Field(default=None, max_length=2000)
    share_time: bool = False
    share_date_precision: DatePrecision = DatePrecision.MONTH

    @model_validator(mode="after")
    def valid_visit(self):
        if self.area_id is None and self.location is None:
            raise ValueError("Say where: an area or a location")
        require_visit_times(self.starts_on, self.ends_on, self.start_time, self.end_time)
        return self


class VisitUpdate(BaseModel):
    area_id: str | None = Field(default=None, min_length=1, max_length=32)
    location: LocationInput | None = None
    position: int | None = Field(default=None, ge=0)
    title: str | None = Field(default=None, min_length=1, max_length=160)
    kind: VisitKind | None = None
    starts_on: date | None = None
    ends_on: date | None = None
    start_time: time | None = None
    end_time: time | None = None
    notes: str | None = Field(default=None, max_length=4000)
    summary: str | None = Field(default=None, max_length=2000)
    share_time: bool | None = None
    share_date_precision: DatePrecision | None = None


class VisitResponse(BaseModel):
    id: str
    position: int
    area: AreaResponse
    location: LocationResponse | None
    title: str | None
    kind: VisitKind | None
    starts_on: date | None
    ends_on: date | None
    start_time: time | None
    end_time: time | None
    notes: str | None
    summary: str | None
    visibility: Visibility
    share_time: bool
    share_date_precision: DatePrecision
    model_config = ConfigDict(from_attributes=True)


class TaskLink(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    url: HttpUrl

    _https = field_validator("url")(require_https)


class TripTaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    notes: str | None = Field(default=None, max_length=4000)
    due_date: date | None = None
    remind_at: AwareDatetime | None = None
    links: list[TaskLink] = Field(default_factory=list, max_length=5)


class TripTaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    notes: str | None = Field(default=None, max_length=4000)
    due_date: date | None = None
    remind_at: AwareDatetime | None = None
    links: list[TaskLink] | None = Field(default=None, max_length=5)
    completed: bool | None = None


class TripTaskResponse(BaseModel):
    id: str
    title: str
    notes: str | None
    due_date: date | None
    remind_at: datetime | None
    reminded_at: datetime | None
    links: list[TaskLink]
    completed_at: datetime | None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class TripTaskAlertResponse(BaseModel):
    id: str
    task_id: str
    kind: str
    title: str
    scheduled_for: datetime
    created_at: datetime
    read_at: datetime | None
    email_sent_at: datetime | None
    email_attempts: int
    email_last_error: str | None
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


def require_route_ends(model):
    """Each end of a route is an area, given directly or through a location that is filed under one."""
    for end in ("departure", "arrival"):
        if getattr(model, f"{end}_area_id") is None and getattr(model, f"{end}_location") is None:
            raise ValueError(f"Say where the route {'starts' if end == 'departure' else 'ends'}: an area or a location")
    return model


class RouteCreate(BaseModel):
    """A route between two areas. Everything else is optional: the exact locations,
    the schedule (both times or neither), booking details and a drawn line."""

    mode: RouteMode
    status: RouteStatus = RouteStatus.PLANNED
    label: str | None = Field(default=None, min_length=1, max_length=160)
    departure_area_id: str | None = Field(default=None, min_length=1, max_length=32)
    arrival_area_id: str | None = Field(default=None, min_length=1, max_length=32)
    departure_location: LocationInput | None = None
    arrival_location: LocationInput | None = None
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
    notes: str | None = Field(default=None, max_length=4000)
    document_asset_ids: list[str] = Field(default_factory=list, max_length=12)
    geometry: GeoJsonLineString | None = None

    _timezones = field_validator("departure_timezone", "arrival_timezone")(require_timezone)
    _ends = model_validator(mode="after")(require_route_ends)

    @model_validator(mode="after")
    def times_come_as_a_pair(self):
        if (self.departs_at is None) != (self.arrives_at is None):
            raise ValueError("Give both the departure and the arrival time, or neither")
        return self

    @field_validator("document_asset_ids")
    @classmethod
    def require_unique_documents(cls, values: list[str]) -> list[str]:
        if len(values) != len(set(values)):
            raise ValueError("A document can only be attached once")
        return values


class RouteUpdate(BaseModel):
    mode: RouteMode | None = None
    status: RouteStatus | None = None
    label: str | None = Field(default=None, min_length=1, max_length=160)
    departure_area_id: str | None = Field(default=None, min_length=1, max_length=32)
    arrival_area_id: str | None = Field(default=None, min_length=1, max_length=32)
    departure_location: LocationInput | None = None
    arrival_location: LocationInput | None = None
    departs_at: datetime | None = None
    arrives_at: datetime | None = None
    departure_timezone: str | None = Field(default=None, max_length=64)
    arrival_timezone: str | None = Field(default=None, max_length=64)
    carrier: str | None = Field(default=None, max_length=160)
    service_reference: str | None = Field(default=None, max_length=40)
    travel_class: str | None = Field(default=None, max_length=80)
    booking_reference: str | None = Field(default=None, max_length=255)
    notes: str | None = Field(default=None, max_length=4000)
    document_asset_ids: list[str] | None = Field(default=None, max_length=12)
    geometry: GeoJsonLineString | None = None

    _timezones = field_validator("departure_timezone", "arrival_timezone")(require_timezone)

    @field_validator("document_asset_ids")
    @classmethod
    def require_unique_documents(cls, values: list[str] | None) -> list[str] | None:
        if values is not None and len(values) != len(set(values)):
            raise ValueError("A document can only be attached once")
        return values


class RouteResponse(BaseModel):
    id: str
    mode: RouteMode
    status: RouteStatus
    label: str | None
    departure_area: AreaResponse
    arrival_area: AreaResponse
    departure_location: LocationResponse | None
    arrival_location: LocationResponse | None
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
    geometry: GeoJsonLineString | None
    visibility: Visibility
    model_config = ConfigDict(from_attributes=True)

    @field_validator("departs_at", "arrives_at")
    @classmethod
    def mark_utc(cls, value: datetime | None) -> datetime | None:
        # SQLite returns stored UTC instants without an offset; a client must
        # never read them as its own local time.
        return value if value is None or value.tzinfo is not None else value.replace(tzinfo=UTC)


class TripResponse(BaseModel):
    id: str
    owner_subject: str
    title: str
    summary: str | None
    starts_on: date | None
    ends_on: date | None
    travel_updates: list[TravelUpdateResponse]
    model_config = ConfigDict(from_attributes=True)


class ShareScopeKind(StrEnum):
    """Every kind of record that can be shared. A scope lists only records
    whose visibility is ``custom``; it never says which fields to show."""

    AREA = "area"
    LOCATION = "location"
    VISIT = "visit"
    ROUTE = "route"
    STAY = "stay"
    TRAVEL_UPDATE = "travel_update"
    MEDIA_DERIVATIVE = "media_derivative"


class ShareScopeTripInput(BaseModel):
    """The small, explicit trip-level portion of a shared view."""

    title: bool = True
    summary: bool = True
    # Trip dates are absent unless the owner chooses a precision to share.
    dates: DatePrecision | None = None

    model_config = ConfigDict(extra="forbid")


class ShareScopeItemInput(BaseModel):
    """One record, with visibility ``custom``, that this audience includes."""

    kind: ShareScopeKind
    id: str = Field(min_length=1, max_length=32)

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
    dates: dict | None
    visits: list[dict]
    places: list[dict]
    updates: list[dict]
    stays: list[dict]
    media: list[dict]
    routes: list[dict]
    navigation: list[dict]


class PublicTripCard(BaseModel):
    slug: str
    title: str | None
    summary: str | None
    dates: dict | None


class PublicProjectionStatusResponse(BaseModel):
    trip_id: str
    scope: dict
    surface_state: SurfaceState
    slug: str | None


class VisibilityUpdate(BaseModel):
    """Set who receives one record: the same choice for every shareable kind."""

    visibility: Visibility


class ShareLinkCreate(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    scope: ShareScopeInput = Field(default_factory=ShareScopeInput)


class ShareLinkUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=120)
    scope: ShareScopeInput | None = None


class ShareLinkActivateRequest(BaseModel):
    # `null` is an explicit owner choice for a revocable link without natural
    # expiry. Omitted retains the safer 30-day default.
    expires_in_days: int | None = Field(default=30, ge=1, le=90)
    reason: str | None = Field(default=None, max_length=500)


class ShareLinkResponse(BaseModel):
    id: str
    series_id: str
    label: str
    state: LinkState
    scope: dict
    token: str | None
    expires_at: datetime | None
    created_at: datetime
    activated_at: datetime | None
    revoked_at: datetime | None
    model_config = ConfigDict(from_attributes=True)


class ShareLinkActivateResponse(ShareLinkResponse):
    pass


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
    alt_text: str | None
    focal_x: int | None
    focal_y: int | None
    visibility: Visibility
    created_at: datetime
    file_url: str
    model_config = ConfigDict(from_attributes=True)


class MediaDerivativeCreate(BaseModel):
    purpose: DerivativePurpose = DerivativePurpose.SHARE
    max_dimension: int = Field(default=1600, ge=64, le=4000)
    remove_audio: bool = False


class MediaDerivativePresentationUpdate(BaseModel):
    travel_update_id: str | None = None
    caption: str | None = Field(default=None, max_length=500)
    alt_text: str | None = Field(default=None, max_length=300)
    focal_x: int | None = Field(default=None, ge=0, le=100)
    focal_y: int | None = Field(default=None, ge=0, le=100)

    model_config = ConfigDict(extra="forbid")


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


# --- Owner-wide document library and emergency information --------------------------


class OwnerDocumentUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    document_kind: DocumentKind | None = None
    linked_trip_id: str | None = Field(default=None)


class OwnerDocumentResponse(BaseModel):
    id: str
    document_kind: DocumentKind
    title: str
    byte_size: int
    content_type: str
    original_filename: str | None
    linked_trip_id: str | None
    created_at: datetime
    deleted_at: datetime | None
    file_url: str
    model_config = ConfigDict(from_attributes=True)


class EmergencyInfoEntryCreate(BaseModel):
    kind: EmergencyInfoKind
    label: str = Field(min_length=1, max_length=160)
    value: str = Field(min_length=1, max_length=255)
    notes: str | None = Field(default=None, max_length=4000)


class EmergencyInfoEntryUpdate(BaseModel):
    kind: EmergencyInfoKind | None = None
    label: str | None = Field(default=None, min_length=1, max_length=160)
    value: str | None = Field(default=None, min_length=1, max_length=255)
    notes: str | None = Field(default=None, max_length=4000)


class EmergencyInfoEntryResponse(BaseModel):
    id: str
    kind: EmergencyInfoKind
    label: str
    value: str
    notes: str | None
    created_at: datetime
    updated_at: datetime
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
    # Whether this server offers the provider at all (GoPro Cloud needs beta access switched on).
    # An unavailable provider is not shown; an available one still needs the owner's token.
    available: bool
    connected: bool
