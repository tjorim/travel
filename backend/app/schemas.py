from datetime import UTC, date, datetime, time
from enum import StrEnum
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    HttpUrl,
    computed_field,
    field_validator,
    model_validator,
)
from pydantic_core import PydanticCustomError

from .markdown import markdown_text, render_contact, render_inline, render_markdown
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
    VisitStatus,
)

COUNTRY_CODE_FIELD = Field(default=None, min_length=2, max_length=2, pattern=r"^[A-Z]{2}$")

MARKDOWN = (
    "Markdown: bold, italic, headings, bulleted, numbered and task lists, links (http, https, mailto), "
    "blockquotes, inline and fenced code, rules and tables. Raw HTML and images are not rendered, and a task "
    "list is display-only: it never creates trip tasks."
)
INLINE_MARKDOWN = (
    "Inline Markdown only: bold, italic and links (http, https, mailto). Headings, lists, other blocks, "
    "raw HTML and images are not rendered."
)
CONTACT = (
    "Plain text, not Markdown: line breaks are kept, and phone numbers starting with + or 0 (tel), email "
    "addresses (mailto) and http(s) addresses become links."
)


def _html(source: str | None) -> str | None:
    """The owner app's sanitized HTML for one Markdown field (see ``app.markdown``)."""
    return render_markdown(source, "owner")


def _html_of(field: str) -> str:
    return f"Sanitized HTML rendered from the Markdown `{field}`; null without text. Read-only."


def require_https(value: HttpUrl | None) -> HttpUrl | None:
    if value is not None and value.scheme != "https":
        raise PydanticCustomError("links_must_use_https", "Links must use HTTPS")
    return value


def require_timezone(value: str | None) -> str | None:
    """Accept only a known IANA zone name such as ``Asia/Taipei``."""
    if value is None:
        return value
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError) as error:
        raise PydanticCustomError("unknown_time_zone", "Unknown time zone") from error
    return value


def require_ordered_dates(start: date | None, end: date | None, message: str) -> None:
    if start is not None and end is not None and end < start:
        raise PydanticCustomError("dates_out_of_order", message)  # ty: ignore[invalid-argument-type]


class InputModel(BaseModel):
    """A payload a client sends: an unknown field is rejected, never silently dropped.

    A misspelled or guessed field would otherwise succeed without storing anything,
    so the caller would believe the change was applied."""

    model_config = ConfigDict(extra="forbid")


class LocationFields(InputModel):
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
    notes: str | None = Field(default=None, max_length=2000, description=MARKDOWN)
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
            raise PydanticCustomError(
                "osm_element_type_and_osm_element_id_must_be_supplied_together",
                "osm_element_type and osm_element_id must be supplied together",
            )
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
            raise PydanticCustomError(
                "supply_an_existing_location_on_its_own_without_other_location_fields",
                "Supply an existing location on its own, without other location fields",
            )
        if self.new_area is not None and self.area_id is not None:
            raise PydanticCustomError("choose_an_existing_area_or_a_new_area", "Choose an existing area or a new area")
        return self


def require_identified_location(location: "LocationInput | None") -> "LocationInput | None":
    """A stay's location must say where it is: a saved location, a name or address, a city or an area."""
    if location is None or location.existing_location_id is not None:
        return location
    located = location.latitude is not None and location.longitude is not None
    if not (
        located
        or location.display_name
        or location.address_line1
        or location.locality
        or location.admin_area
        or location.area_id
    ):
        raise PydanticCustomError(
            "say_where_this_stay_is_choose_a_saved_location_or_fill_in_an_address_a_city_or_an_area",
            "Say where this stay is: choose a saved location, or fill in an address, a city or an area",
        )
    return location


class LocationUpdate(InputModel):
    """Owner corrections to a saved location; omitted fields retain their values.

    A reused location is one record, so corrections appear in every linked
    stay, visit, route end and travel update.
    """

    label: str | None = Field(default=None, min_length=1, max_length=120)
    area_id: str | None = Field(default=None, min_length=1, max_length=32)
    share_address: bool | None = None
    display_name: str | None = Field(default=None, max_length=500)
    address_line1: str | None = Field(default=None, max_length=160)
    address_line2: str | None = Field(default=None, max_length=160)
    locality: str | None = Field(default=None, max_length=120)
    admin_area: str | None = Field(default=None, max_length=120)
    postal_code: str | None = Field(default=None, max_length=20)
    country_code: str | None = COUNTRY_CODE_FIELD
    notes: str | None = Field(default=None, max_length=2000, description=MARKDOWN)
    # The map target, applied from a place search result the owner has verified.
    # An omitted field keeps its value; an explicit null clears it. Each group
    # is set or cleared as a whole, and the owner-only OSM link follows the element.
    latitude: float | None = Field(
        default=None, ge=-90, le=90, description="Point latitude; send with longitude, or null with it to clear."
    )
    longitude: float | None = Field(
        default=None, ge=-180, le=180, description="Point longitude; send with latitude, or null with it to clear."
    )
    viewport_north: float | None = Field(default=None, ge=-90, le=90)
    viewport_south: float | None = Field(default=None, ge=-90, le=90)
    viewport_east: float | None = Field(default=None, ge=-180, le=180)
    viewport_west: float | None = Field(default=None, ge=-180, le=180)
    osm_element_type: Literal["node", "way", "relation"] | None = Field(
        default=None, description="OSM element type; send with osm_element_id, or null with it to clear."
    )
    osm_element_id: str | None = Field(
        default=None,
        min_length=1,
        max_length=32,
        pattern=r"^[0-9]+$",
        description="OSM element id; send with osm_element_type, or null with it to clear.",
    )
    navigation_provider: str | None = Field(default=None, max_length=40)
    navigation_provider_place_id: str | None = Field(default=None, max_length=255)

    @model_validator(mode="after")
    def geo_groups_are_set_or_cleared_together(self):
        supplied = self.model_fields_set
        groups = {
            "latitude_and_longitude_must_be_supplied_together": ("latitude", "longitude"),
            "the_four_viewport_edges_must_be_supplied_together": (
                "viewport_north",
                "viewport_south",
                "viewport_east",
                "viewport_west",
            ),
            "osm_element_type_and_osm_element_id_must_be_supplied_together": ("osm_element_type", "osm_element_id"),
        }
        for code, fields in groups.items():
            present = [field for field in fields if field in supplied]
            together = "Supply " + ", ".join(fields) + " together"
            if present and len(present) != len(fields):
                raise PydanticCustomError(code, together)  # ty: ignore[invalid-argument-type]
            values = [getattr(self, field) for field in present]
            if values and any(value is None for value in values) and not all(value is None for value in values):
                raise PydanticCustomError(code, together + ", or null them together")  # ty: ignore[invalid-argument-type]
        if (
            self.viewport_north is not None
            and self.viewport_south is not None
            and self.viewport_north < self.viewport_south
        ):
            raise PydanticCustomError(
                "the_viewport_north_edge_must_not_be_south_of_the_south_edge",
                "The viewport's north edge must not be south of its south edge",
            )
        return self


class MergeRequest(InputModel):
    """Fold duplicate locations or areas into ``keep_id``. Without ``confirm`` it only previews."""

    keep_id: str = Field(min_length=1, max_length=32)
    duplicate_ids: list[str] = Field(min_length=1, max_length=50)
    confirm: bool = False


class LocationMergeDuplicate(BaseModel):
    """What merging one duplicate moves to the kept location, and what it may hide."""

    id: str
    label: str | None
    display_name: str | None
    area_id: str
    visits: int
    stays: int
    routes: int
    travel_updates: int
    # Audiences ("public page" or a link's label) that receive this duplicate
    # but not the kept location, so the merge would narrow what they see.
    narrowed_audiences: list[str]


class LocationMergeResult(BaseModel):
    keep_id: str
    applied: bool
    duplicates: list[LocationMergeDuplicate]
    warnings: list[str]


class AreaMergeDuplicate(BaseModel):
    """What merging one duplicate area moves to the kept area, and what it may hide."""

    id: str
    label: str
    locations: int
    visits: int
    routes: int
    travel_updates: int
    narrowed_audiences: list[str]


class AreaMergeResult(BaseModel):
    keep_id: str
    applied: bool
    duplicates: list[AreaMergeDuplicate]
    # Locations in the merged area that only name the city, and so are likely
    # duplicates of each other: candidates for merge_locations.
    city_level_location_ids: list[str]
    warnings: list[str]


class LocationResponse(LocationFields):
    id: str
    visibility: Visibility
    osm_url: str | None
    # A response is read from stored data, not sent by a client.
    model_config = ConfigDict(from_attributes=True, extra="ignore")

    @computed_field(description=_html_of("notes"))
    @property
    def notes_html(self) -> str | None:
        return _html(self.notes)


class MarkdownRenderRequest(InputModel):
    """Owner-only preview of one field, rendered exactly as the stored field will be."""

    source: str = Field(max_length=10000)
    format: Literal["markdown", "inline", "contact"] = Field(
        default="markdown",
        description="markdown for long-form fields, inline for a media caption, contact for a stay's contact details.",
    )


class MarkdownRenderResponse(BaseModel):
    html: str | None = Field(description="Sanitized HTML; null without text.")
    text: str | None = Field(description="The source as one line of plain text; null without text.")


TranslationLanguage = Literal["nl", "en"]


class TranslationDraftRequest(InputModel):
    """Owner-only request for a machine-translated draft of one field's text."""

    # At about 170 characters/s plus a 15-30 s cold start, this stays under the
    # 100 s a proxied Cloudflare request may stay open (the request is held open).
    text: str = Field(min_length=1, max_length=8000)
    source: TranslationLanguage
    target: TranslationLanguage

    @model_validator(mode="after")
    def languages_differ(self) -> "TranslationDraftRequest":
        if self.source == self.target:
            raise PydanticCustomError("translation_languages_must_differ", "Choose two different languages")
        return self


class TranslationDraftResponse(BaseModel):
    text: str = Field(description="The translated draft. Nothing is stored; the owner reviews and edits it.")
    source: TranslationLanguage
    target: TranslationLanguage
    machine_translated: Literal[True] = True


class PlaceSearchRequest(InputModel):
    query: str = Field(min_length=2, max_length=200)


class PlaceReverseGeocodeRequest(InputModel):
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


class AreaInput(InputModel):
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


class AreaUpdate(InputModel):
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
    model_config = ConfigDict(from_attributes=True, extra="ignore")


class TripCreate(InputModel):
    title: str = Field(min_length=1, max_length=160)
    summary: str | None = Field(default=None, max_length=4000, description=MARKDOWN)
    starts_on: date | None = None
    ends_on: date | None = None

    @model_validator(mode="after")
    def end_not_before_start(self):
        require_ordered_dates(self.starts_on, self.ends_on, "The trip cannot end before it starts")
        return self


class TripUpdate(InputModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    summary: str | None = Field(default=None, max_length=4000, description=MARKDOWN)
    starts_on: date | None = None
    ends_on: date | None = None


def _require_unique_media_assets(values: list[str] | None) -> list[str] | None:
    if values is not None and len(values) != len(set(values)):
        raise PydanticCustomError("a_media_asset_can_only_be_attached_once", "A media asset can only be attached once")
    return values


class TravelUpdateCreate(InputModel):
    """A reisupdate: what happened, with a private part and a shared part.

    Private: ``private_notes``, the exact ``location`` and the attached
    ``media_asset_ids``. Shared once ``visibility`` allows it: ``title``,
    ``body`` (empty until written for visitors), the date at ``date_precision``
    and the ``area_id`` (an area)."""

    occurred_at: datetime
    date_precision: DatePrecision = DatePrecision.DAY
    title: str = Field(min_length=1, max_length=160)
    body: str = Field(default="", max_length=10000, description=MARKDOWN)
    private_notes: str | None = Field(default=None, max_length=10000, description=MARKDOWN)
    area_id: str | None = None
    location: LocationInput | None = None
    media_asset_ids: list[str] = Field(default_factory=list, max_length=12)
    visibility: Visibility = Visibility.PRIVATE

    _unique_media = field_validator("media_asset_ids")(_require_unique_media_assets)


class TravelUpdatePatch(InputModel):
    occurred_at: datetime | None = None
    date_precision: DatePrecision | None = None
    title: str | None = Field(default=None, min_length=1, max_length=160)
    body: str | None = Field(default=None, max_length=10000, description=MARKDOWN)
    private_notes: str | None = Field(default=None, max_length=10000, description=MARKDOWN)
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

    @computed_field(description=_html_of("body"))
    @property
    def body_html(self) -> str | None:
        return _html(self.body)

    @computed_field(description=_html_of("private_notes"))
    @property
    def private_notes_html(self) -> str | None:
        return _html(self.private_notes)


def booked_is_confirmed(status: object) -> object:
    """``booked`` was folded into ``confirmed``; older clients and archive files may still send it."""
    return "confirmed" if status == "booked" else status


_legacy_booked = field_validator("status", mode="before")(booked_is_confirmed)

ROUTE_STATUS = (
    "idea: a candidate being compared (two flights, a train or a bus) that covers no journey and cannot be shared; "
    "planned: the intended route; confirmed: reserved or confirmed (booked means the same); cancelled."
)

STAY_STATUS = (
    "idea: a candidate being compared, which may overlap other stays, covers no night and cannot be shared; "
    "planned: the intended stay; confirmed: reserved or confirmed (booked means the same); cancelled."
)


class StayCreate(InputModel):
    """The nights at one accommodation. ``check_out_date`` is the departure
    morning, so a stay covers the nights ``check_in_date`` up to, but not
    including, ``check_out_date``. Every stay has a location. While the
    accommodation is still being chosen, give only ``area_id``: the stay then
    uses that area's shared city-level location instead of a new copy."""

    area_id: str | None = Field(default=None, min_length=1, max_length=32)
    location: LocationInput | None = None
    check_in_date: date
    check_out_date: date
    check_in_time: time | None = None
    check_out_time: time | None = None
    status: StayStatus = Field(default=StayStatus.PLANNED, description=STAY_STATUS)
    property_name: str | None = Field(default=None, min_length=1, max_length=160)
    website_url: HttpUrl | None = None
    booking_reference: str | None = Field(default=None, max_length=255)
    contact_details: str | None = Field(default=None, max_length=2000, description=CONTACT)
    notes: str | None = Field(default=None, max_length=4000, description=MARKDOWN)
    share_date_precision: DatePrecision = DatePrecision.MONTH

    _https = field_validator("website_url")(require_https)
    _located = field_validator("location")(require_identified_location)
    _booked = _legacy_booked

    @model_validator(mode="after")
    def says_where(self):
        if self.location is None and self.area_id is None:
            raise PydanticCustomError(
                "say_where_this_stay_is_an_area_or_a_location", "Say where this stay is: an area, or a location"
            )
        if self.location is not None and self.area_id is not None:
            raise PydanticCustomError(
                "give_an_area_or_a_location_not_both_a_location_names_its_own_area",
                "Give an area or a location, not both; a location names its own area",
            )
        return self


class StayUpdate(InputModel):
    """Change a stay. ``area_id`` alone moves it to that area and, unless its
    location is already there, to the area's city-level location; setting
    ``location`` to null keeps the area but forgets the accommodation."""

    area_id: str | None = Field(default=None, min_length=1, max_length=32)
    location: LocationInput | None = None
    check_in_date: date | None = None
    check_out_date: date | None = None
    check_in_time: time | None = None
    check_out_time: time | None = None
    status: StayStatus | None = Field(default=None, description=STAY_STATUS)
    property_name: str | None = Field(default=None, min_length=1, max_length=160)
    website_url: HttpUrl | None = None
    booking_reference: str | None = Field(default=None, max_length=255)
    contact_details: str | None = Field(default=None, max_length=2000, description=CONTACT)
    notes: str | None = Field(default=None, max_length=4000, description=MARKDOWN)
    share_date_precision: DatePrecision | None = None

    _https = field_validator("website_url")(require_https)
    _located = field_validator("location")(require_identified_location)
    _booked = _legacy_booked


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

    area_id: str | None = Field(default=None, min_length=1, max_length=32)
    location: LocationInput | None = None
    position: int | None = Field(default=None, ge=0)
    title: str | None = Field(default=None, min_length=1, max_length=160)
    kind: VisitKind | None = None
    status: VisitStatus = VisitStatus.PLANNED
    starts_on: date | None = None
    ends_on: date | None = None
    start_time: time | None = None
    end_time: time | None = None
    notes: str | None = Field(default=None, max_length=4000, description=MARKDOWN)
    summary: str | None = Field(default=None, max_length=2000, description=MARKDOWN)
    share_time: bool = False
    share_date_precision: DatePrecision = DatePrecision.MONTH

    @model_validator(mode="after")
    def valid_visit(self):
        if self.area_id is None and self.location is None:
            raise PydanticCustomError("say_where_an_area_or_a_location", "Say where: an area or a location")
        require_visit_times(self.starts_on, self.ends_on, self.start_time, self.end_time)
        return self


class VisitUpdate(InputModel):
    area_id: str | None = Field(default=None, min_length=1, max_length=32)
    location: LocationInput | None = None
    position: int | None = Field(default=None, ge=0)
    title: str | None = Field(default=None, min_length=1, max_length=160)
    kind: VisitKind | None = None
    status: VisitStatus | None = None
    starts_on: date | None = None
    ends_on: date | None = None
    start_time: time | None = None
    end_time: time | None = None
    notes: str | None = Field(default=None, max_length=4000, description=MARKDOWN)
    summary: str | None = Field(default=None, max_length=2000, description=MARKDOWN)
    share_time: bool | None = None
    share_date_precision: DatePrecision | None = None


class RouteReference(BaseModel):
    id: str
    title: str


class VisitRouteCheck(InputModel):
    """A visit as it is being typed, before it is saved: enough to tell whether it restates a route."""

    area_id: str | None = Field(default=None, min_length=1, max_length=32)
    location_id: str | None = Field(default=None, min_length=1, max_length=32)
    title: str | None = Field(default=None, max_length=160)
    summary: str | None = Field(default=None, max_length=2000)
    starts_on: date | None = None
    ends_on: date | None = None


class VisitResponse(BaseModel):
    id: str
    position: int
    area: AreaResponse
    location: LocationResponse | None
    title: str | None
    kind: VisitKind | None
    status: VisitStatus
    starts_on: date | None
    ends_on: date | None
    start_time: time | None
    end_time: time | None
    notes: str | None
    summary: str | None
    visibility: Visibility
    share_time: bool
    share_date_precision: DatePrecision
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


class TaskLink(InputModel):
    label: str = Field(min_length=1, max_length=80)
    url: HttpUrl

    _https = field_validator("url")(require_https)


class StoredTaskLink(TaskLink):
    """A saved link as a response reads it back: stored data is not rejected for an extra key."""

    model_config = ConfigDict(extra="ignore")


class PackingListCreate(InputModel):
    name: str = Field(default="Packing list", min_length=1, max_length=160)
    copy_from_list_id: str | None = None
    template_ids: list[str] = Field(default_factory=list, max_length=10)


class PackingListUpdate(InputModel):
    name: str = Field(min_length=1, max_length=160)


class PackingListResponse(BaseModel):
    id: str
    trip_id: str
    name: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class PackingTemplateCreate(InputModel):
    name: str = Field(min_length=1, max_length=160)


class PackingTemplateResponse(BaseModel):
    id: str
    name: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class PackingBagCreate(InputModel):
    name: str = Field(min_length=1, max_length=160)
    type: str | None = Field(default=None, max_length=80)
    position: int | None = Field(default=None, ge=0)
    weight_limit_g: int | None = Field(default=None, gt=0)


class PackingBagUpdate(InputModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    type: str | None = Field(default=None, max_length=80)
    position: int | None = Field(default=None, ge=0)
    weight_limit_g: int | None = Field(default=None, gt=0)


class PackingBagResponse(BaseModel):
    id: str
    list_id: str
    name: str
    type: str | None
    position: int
    weight_limit_g: int | None
    model_config = ConfigDict(from_attributes=True)


class PackingItemCreate(InputModel):
    label: str = Field(min_length=1, max_length=160)
    quantity: int = Field(default=1, ge=1, le=99)
    category: str | None = Field(default=None, max_length=80)
    bag_id: str | None = None
    position: int | None = Field(default=None, ge=0)
    packed: bool = False
    essential: bool = False
    last_minute: bool = False
    valuable: bool = False
    cabin_only: bool = False
    checked_only: bool = False
    notes: str | None = Field(default=None, max_length=4000)
    weight_g: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def one_baggage_constraint(self):
        if self.cabin_only and self.checked_only:
            raise PydanticCustomError(
                "an_item_cannot_be_both_cabin_only_and_checked_only",
                "An item cannot be both cabin-only and checked-only",
            )
        return self


class PackingItemUpdate(InputModel):
    label: str | None = Field(default=None, min_length=1, max_length=160)
    quantity: int | None = Field(default=None, ge=1, le=99)
    category: str | None = Field(default=None, max_length=80)
    bag_id: str | None = None
    position: int | None = Field(default=None, ge=0)
    packed: bool | None = None
    essential: bool | None = None
    last_minute: bool | None = None
    valuable: bool | None = None
    cabin_only: bool | None = None
    checked_only: bool | None = None
    notes: str | None = Field(default=None, max_length=4000)
    weight_g: int | None = Field(default=None, ge=0)


class PackingItemResponse(BaseModel):
    id: str
    list_id: str
    bag_id: str | None
    label: str
    quantity: int
    category: str | None
    packed: bool
    position: int
    essential: bool
    last_minute: bool
    valuable: bool
    cabin_only: bool
    checked_only: bool
    notes: str | None
    weight_g: int | None
    model_config = ConfigDict(from_attributes=True)


class TripTaskCreate(InputModel):
    title: str = Field(min_length=1, max_length=160)
    notes: str | None = Field(default=None, max_length=4000, description=MARKDOWN)
    due_date: date | None = None
    remind_at: AwareDatetime | None = None
    links: list[TaskLink] = Field(default_factory=list, max_length=5)


class TripTaskUpdate(InputModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    notes: str | None = Field(default=None, max_length=4000, description=MARKDOWN)
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
    links: list[StoredTaskLink]
    completed_at: datetime | None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

    @computed_field(description=_html_of("notes"))
    @property
    def notes_html(self) -> str | None:
        return _html(self.notes)


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


class GeoJsonLineString(InputModel):
    """A reviewed GeoJSON line, entered by the owner rather than computed
    from a raw recording. Coordinates are longitude, latitude pairs."""

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

    model_config = ConfigDict(extra="ignore")


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
    status: RouteStatus = Field(default=RouteStatus.PLANNED, description=ROUTE_STATUS)
    label: str | None = Field(default=None, min_length=1, max_length=160)
    departure_area_id: str | None = Field(default=None, min_length=1, max_length=32)
    arrival_area_id: str | None = Field(default=None, min_length=1, max_length=32)
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
    document_asset_ids: list[str] = Field(default_factory=list, max_length=12)
    geometry: GeoJsonLineString | None = None

    _timezones = field_validator("departure_timezone", "arrival_timezone")(require_timezone)
    _booked = _legacy_booked
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
        if len(values) != len(set(values)):
            raise PydanticCustomError("a_document_can_only_be_attached_once", "A document can only be attached once")
        return values


class RouteUpdate(InputModel):
    mode: RouteMode | None = None
    status: RouteStatus | None = Field(default=None, description=ROUTE_STATUS)
    label: str | None = Field(default=None, min_length=1, max_length=160)
    departure_area_id: str | None = Field(default=None, min_length=1, max_length=32)
    arrival_area_id: str | None = Field(default=None, min_length=1, max_length=32)
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
    document_asset_ids: list[str] | None = Field(default=None, max_length=12)
    geometry: GeoJsonLineString | None = None

    _timezones = field_validator("departure_timezone", "arrival_timezone")(require_timezone)
    _booked = _legacy_booked

    @field_validator("document_asset_ids")
    @classmethod
    def require_unique_documents(cls, values: list[str] | None) -> list[str] | None:
        if values is not None and len(values) != len(set(values)):
            raise PydanticCustomError("a_document_can_only_be_attached_once", "A document can only be attached once")
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


class TripResponse(BaseModel):
    id: str
    owner_subject: str
    title: str
    summary: str | None
    starts_on: date | None
    ends_on: date | None
    travel_updates: list[TravelUpdateResponse]
    model_config = ConfigDict(from_attributes=True)

    @computed_field(description=_html_of("summary"))
    @property
    def summary_html(self) -> str | None:
        return _html(self.summary)


class OverviewAudience(BaseModel):
    """What one audience (the public page or a draft/active link) receives right now."""

    kind: Literal["public", "share_link"]
    id: str | None
    label: str
    state: str
    live: bool
    shares_title: bool
    shares_summary: bool
    dates_precision: DatePrecision | None
    scope_items: int
    delivered: dict[str, int]
    without_map_point: dict[str, int]


class OverviewWarning(BaseModel):
    code: str
    severity: Literal["warning", "info"]
    message: str
    # The audience's label, and a link's id (null for the public page).
    audience: str | None = None
    audience_id: str | None = None
    # The label, title or precision the warning is about.
    text: str | None = None
    kind: str | None = None
    id: str | None = None


class TripOverviewResponse(BaseModel):
    """Owner-only: counts per kind, who receives what, and what to review before sharing."""

    trip_id: str
    title: str
    starts_on: date | None
    ends_on: date | None
    counts: dict[str, int]
    visibility: dict[str, dict[str, int]]
    audiences: list[OverviewAudience]
    warnings: list[OverviewWarning]


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


class ShareScopeTripInput(InputModel):
    """The small, explicit trip-level portion of a shared view."""

    title: bool = True
    summary: bool = True
    # Trip dates are absent unless the owner chooses a precision to share.
    dates: DatePrecision | None = None


class ShareScopeItemInput(InputModel):
    """One record, with visibility ``custom``, that this audience includes."""

    kind: ShareScopeKind
    id: str = Field(min_length=1, max_length=32)


class ShareScopeInput(InputModel):
    """The explicit, owner-selected content of a public or unlisted view.

    Anything not listed here is absent from the rendered projection, never
    merely hidden by a client.
    """

    schema_version: Literal["travel/share-scope@1"] = "travel/share-scope@1"
    trip: ShareScopeTripInput = Field(default_factory=ShareScopeTripInput)
    items: list[ShareScopeItemInput] = Field(default_factory=list, max_length=200)


class ProjectionDocument(BaseModel):
    schema_version: str
    title: str | None
    summary: str | None = Field(description=MARKDOWN)
    summary_html: str | None = Field(default=None, description=_html_of("summary") + " Links are nofollow.")
    summary_text: str | None = Field(default=None, description="The summary as one line of plain text, for previews.")
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
    summary: str | None = Field(description=MARKDOWN)
    dates: dict | None

    @computed_field(description="The summary as one line of plain text: a card shows it instead of rendering it.")
    @property
    def summary_text(self) -> str | None:
        return markdown_text(self.summary)


class PublicProjectionStatusResponse(BaseModel):
    trip_id: str
    scope: dict
    surface_state: SurfaceState
    slug: str | None


class VisibilityUpdate(InputModel):
    """Set who receives one record: the same choice for every shareable kind."""

    visibility: Visibility


class ShareLinkCreate(InputModel):
    label: str = Field(min_length=1, max_length=120)
    scope: ShareScopeInput = Field(default_factory=ShareScopeInput)


class ShareLinkUpdate(InputModel):
    label: str | None = Field(default=None, min_length=1, max_length=120)
    scope: ShareScopeInput | None = None


class ShareLinkActivateRequest(InputModel):
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


class AuditReasonInput(InputModel):
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

    @computed_field(description=_html_of("caption") + " Inline elements only.")
    @property
    def caption_html(self) -> str | None:
        return render_inline(self.caption, "owner")


class MediaDerivativeCreate(InputModel):
    purpose: DerivativePurpose = DerivativePurpose.SHARE
    max_dimension: int = Field(default=1600, ge=64, le=4000)
    remove_audio: bool = False


class MediaDerivativePresentationUpdate(InputModel):
    travel_update_id: str | None = None
    caption: str | None = Field(default=None, max_length=500, description=INLINE_MARKDOWN)
    alt_text: str | None = Field(default=None, max_length=300)
    focal_x: int | None = Field(default=None, ge=0, le=100)
    focal_y: int | None = Field(default=None, ge=0, le=100)


class MediaTravelUpdateCandidatesRequest(InputModel):
    """Only assets the owner explicitly selected are eligible for review."""

    media_asset_ids: list[str] = Field(min_length=1, max_length=100)

    @field_validator("media_asset_ids")
    @classmethod
    def require_unique_assets(cls, values: list[str]) -> list[str]:
        if len(values) != len(set(values)):
            raise PydanticCustomError(
                "a_media_asset_can_only_be_selected_once", "A media asset can only be selected once"
            )
        return values


class MediaTravelUpdateTimeOption(BaseModel):
    media_asset_id: str
    captured_at: datetime
    captured_local: bool = False


class MediaTravelUpdateLocationOption(MediaGpsCoordinates):
    media_asset_ids: list[str]


class MediaTravelUpdateCandidateResponse(BaseModel):
    id: str
    media_asset_ids: list[str]
    starts_at: datetime | None
    ends_at: datetime | None
    captured_local: bool = False
    time_options: list[MediaTravelUpdateTimeOption]
    location_options: list[MediaTravelUpdateLocationOption]


class MediaTravelUpdateCandidatesResponse(BaseModel):
    """Ephemeral owner-only review data; it is never a published resource."""

    grouping_window_minutes: int
    gps_agreement_metres: int
    candidates: list[MediaTravelUpdateCandidateResponse]
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


class OwnerDocumentUpdate(InputModel):
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


class EmergencyInfoEntryCreate(InputModel):
    kind: EmergencyInfoKind
    label: str = Field(min_length=1, max_length=160)
    value: str = Field(min_length=1, max_length=255)
    notes: str | None = Field(default=None, max_length=4000, description=MARKDOWN)


class EmergencyInfoEntryUpdate(InputModel):
    kind: EmergencyInfoKind | None = None
    label: str | None = Field(default=None, min_length=1, max_length=160)
    value: str | None = Field(default=None, min_length=1, max_length=255)
    notes: str | None = Field(default=None, max_length=4000, description=MARKDOWN)


class EmergencyInfoEntryResponse(BaseModel):
    id: str
    kind: EmergencyInfoKind
    label: str
    value: str
    notes: str | None
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)

    @computed_field(description=_html_of("notes"))
    @property
    def notes_html(self) -> str | None:
        return _html(self.notes)

    @computed_field(description="The notes as one line of plain text, for the list row. Read-only.")
    @property
    def notes_text(self) -> str | None:
        return markdown_text(self.notes)


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


class ProviderTokenSet(InputModel):
    access_token: str = Field(min_length=1, max_length=4096)


class ProviderConnectionStatus(BaseModel):
    """A deliberately non-secret view of an owner's provider connection."""

    provider: ImportProvider
    # Whether this server offers the provider at all (GoPro Cloud needs beta access switched on).
    # An unavailable provider is not shown; an available one still needs the owner's token.
    available: bool
    connected: bool
