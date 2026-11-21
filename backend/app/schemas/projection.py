"""The public projection contract: what a visitor reads."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, SerializerFunctionWrapHandler, computed_field, model_serializer

from app.core.markdown import markdown_text
from app.models import DatePrecision, PlanningStatus, RouteMode
from app.schemas.base import INLINE_MARKDOWN, LANGUAGE_MARKER, MARKDOWN, ResponseModel, TextLanguage, _html_of
from app.schemas.live_location import CurrentLocation

LOCAL_NAME_SHOWN = (
    "The name of the place as written where it is, present only beside a delivered `label` (it follows the label's "
    "visibility) and only when the owner entered one. It is in no particular language, so the page sets no `lang` "
    "on it."
)


class ProjectionRecord(BaseModel):
    """A record a visitor receives. Its fields *are* the allowlist: the renderers in ``app.services.sharing.projection`` build these
    models and nothing else, so a field only reaches a visitor once it is declared here. Unknown keys are refused.

    A field with a default is delivered only under the condition its description names. It is absent otherwise, which
    is not the same as null: serialization keeps exactly the fields that were set, so the delivered JSON is the same
    whether a record is built here or validated back from its own output."""

    model_config = ConfigDict(extra="forbid", use_enum_values=True)

    @model_serializer(mode="wrap")
    def _only_set(self, handler: SerializerFunctionWrapHandler):  # no return annotation: it would replace the schema
        return {key: value for key, value in handler(self).items() if key in self.model_fields_set}


class ProjectionDates(ProjectionRecord):
    """The trip's travel dates, cut to the precision the audience may read."""

    starts_on: str | None
    ends_on: str | None
    date_precision: DatePrecision


class ProjectionArea(ProjectionRecord):
    """An area embedded in a record: its label, region, country and a point rounded to two decimals."""

    label: str | None
    label_lang: TextLanguage | None = Field(default=None, description=LANGUAGE_MARKER)
    local_name: str | None = Field(default=None, description=LOCAL_NAME_SHOWN)
    country_code: str | None
    region: str | None
    latitude: float | None
    longitude: float | None


class ProjectionAddress(ProjectionRecord):
    """A location's address, delivered only when the owner chose to share it; empty parts are left out."""

    line1: str | None = None
    line2: str | None = None
    postal_code: str | None = None
    locality: str | None = None
    admin_area: str | None = None


class ProjectionPlace(ProjectionRecord):
    """A shared area or location: in `places`, and embedded as the `location` of a visit, stay or update."""

    id: str
    label: str | None
    label_lang: TextLanguage | None = Field(default=None, description=LANGUAGE_MARKER)
    local_name: str | None = Field(default=None, description=LOCAL_NAME_SHOWN)
    country_code: str | None
    region: str | None
    latitude: float | None
    longitude: float | None
    address: ProjectionAddress | None = Field(
        default=None, description="Only a location whose owner shares its address."
    )


class ProjectionVisit(ProjectionRecord):
    id: str
    title: str | None
    title_lang: TextLanguage | None = Field(default=None, description=LANGUAGE_MARKER)
    summary: str | None = Field(description=MARKDOWN)
    summary_lang: TextLanguage | None = Field(default=None, description=LANGUAGE_MARKER)
    summary_html: str | None = Field(description=_html_of("summary"))
    place: ProjectionArea | None
    date_precision: DatePrecision
    starts_on: str | None = Field(default=None, description="Only a visit that has a start day.")
    ends_on: str | None = Field(default=None, description="With `starts_on`; null for a visit that has no end.")
    start_time: str | None = Field(
        default=None, description="HH:MM local at the visit; only when the owner shares the time, at day precision."
    )
    end_time: str | None = Field(default=None, description="With `start_time`; null when the visit has no end time.")
    timezone: str | None = Field(default=None, description="With `start_time`: the zone those times are local in.")
    location: ProjectionPlace | None = Field(default=None, description="Only a location this audience receives.")


class ProjectionStay(ProjectionRecord):
    id: str
    title: str | None
    title_lang: TextLanguage | None = Field(default=None, description=LANGUAGE_MARKER)
    place: ProjectionArea | None
    date_precision: DatePrecision
    starts_on: str | None
    ends_on: str | None
    location: ProjectionPlace | None = Field(default=None, description="Only a location this audience receives.")


class ProjectionUpdate(ProjectionRecord):
    id: str
    title: str
    title_lang: TextLanguage | None = Field(default=None, description=LANGUAGE_MARKER)
    body: str = Field(description=MARKDOWN)
    body_lang: TextLanguage | None = Field(default=None, description=LANGUAGE_MARKER)
    body_html: str | None = Field(description=_html_of("body"))
    date_precision: DatePrecision
    story_date: str | None
    place: ProjectionArea | None
    location: ProjectionPlace | None = Field(default=None, description="Only a location this audience receives.")


class ProjectionFile(ProjectionRecord):
    """A projection-local file marker: it discloses no object key, original asset or canonical id."""

    id: str


class ProjectionMedia(ProjectionRecord):
    id: str
    video: ProjectionFile | None = Field(default=None, description="Only a video.")
    poster: ProjectionFile | None = Field(default=None, description="Only a video: its still frame.")
    duration_seconds: float | None = Field(default=None, description="Only a video.")
    image: ProjectionFile | None = Field(default=None, description="Only a photo.")
    caption: str | None = Field(description=INLINE_MARKDOWN)
    caption_lang: TextLanguage | None = Field(default=None, description=LANGUAGE_MARKER)
    caption_html: str | None = Field(description=_html_of("caption"))
    alt_text: str | None
    alt_text_lang: TextLanguage | None = Field(default=None, description=LANGUAGE_MARKER)
    width: int | None
    height: int | None
    focal_x: int | None
    focal_y: int | None
    update: str | None = Field(
        default=None, description="The id of the shared `updates` record this photo travels with."
    )


class ProjectionRouteLine(ProjectionRecord):
    """The owner's drawn line: longitude, latitude pairs."""

    type: Literal["LineString"]
    coordinates: list[Annotated[list[float], Field(min_length=2, max_length=2)]]


class ProjectionRoutePoint(ProjectionRecord):
    """One end of a route on the map, delivered only when that location is itself shared."""

    label: str
    label_lang: TextLanguage | None = Field(default=None, description=LANGUAGE_MARKER)
    local_name: str | None = Field(default=None, description=LOCAL_NAME_SHOWN)
    country_code: str | None
    latitude: float
    longitude: float
    kind: Literal["airport", "place"]


class ProjectionRouteMap(ProjectionRecord):
    departure: ProjectionRoutePoint | None
    arrival: ProjectionRoutePoint | None


class ProjectionRoute(ProjectionRecord):
    id: str
    mode: RouteMode
    status: PlanningStatus
    label: str | None
    label_lang: TextLanguage | None = Field(default=None, description=LANGUAGE_MARKER)
    departure: ProjectionArea | None
    arrival: ProjectionArea | None
    carrier: str | None
    service_reference: str | None
    departs_on: str | None = Field(default=None, description="Only a route that has a departure day.")
    date_precision: DatePrecision | None = Field(default=None, description="With `departs_on`.")
    departs_at: str | None = Field(
        default=None, description="An instant (ISO 8601, UTC); only to an audience that may read days."
    )
    arrives_at: str | None = Field(default=None, description="With `departs_at`.")
    departure_timezone: str | None = Field(default=None, description="With `departs_at`.")
    arrival_timezone: str | None = Field(default=None, description="With `departs_at`.")
    geometry: ProjectionRouteLine | None = Field(default=None, description="Only a route with a drawn line.")
    map: ProjectionRouteMap | None = Field(default=None, description="Only a route with a shared location at an end.")


class ProjectionNavigation(ProjectionRecord):
    """A shared place someone may navigate to; the id is the place's, and directions are fetched by it."""

    id: str


class ProjectionDocument(ResponseModel):
    current_locations: list[CurrentLocation] | None = Field(default=None, exclude_if=lambda value: value is None)
    numbers: dict[Literal["days", "areas", "countries", "nights"], int] | None = Field(
        default=None,
        exclude_if=lambda value: value is None,
        description="Only owner-selected figures derived from this exact document; absent for legacy scopes.",
    )
    schema_version: str
    title: str | None
    title_lang: TextLanguage | None = Field(
        default=None, exclude_if=lambda value: value is None, description=LANGUAGE_MARKER
    )
    summary: str | None = Field(description=MARKDOWN)
    summary_lang: TextLanguage | None = Field(
        default=None, exclude_if=lambda value: value is None, description=LANGUAGE_MARKER
    )
    summary_html: str | None = Field(default=None, description=_html_of("summary") + " Links are nofollow.")
    summary_text: str | None = Field(default=None, description="The summary as one line of plain text, for previews.")
    dates: ProjectionDates | None
    cover: str | None = Field(
        default=None,
        description="The id of the `media` photo this audience shows as the trip's cover, "
        "or null when the owner chose none or this audience does not receive the chosen photo.",
    )
    visits: list[ProjectionVisit]
    places: list[ProjectionPlace]
    updates: list[ProjectionUpdate]
    stays: list[ProjectionStay]
    media: list[ProjectionMedia]
    routes: list[ProjectionRoute]
    navigation: list[ProjectionNavigation]


class PublicTripCover(BaseModel):
    url: str
    width: int | None
    height: int | None
    alt_text: str | None
    alt_text_lang: TextLanguage | None = Field(
        default=None, exclude_if=lambda value: value is None, description=LANGUAGE_MARKER
    )
    focal_x: float | None
    focal_y: float | None


class PublicTripCard(ResponseModel):
    cover: PublicTripCover | None = None
    slug: str
    title: str | None
    title_lang: TextLanguage | None = Field(
        default=None, exclude_if=lambda value: value is None, description=LANGUAGE_MARKER
    )
    summary: str | None = Field(description=MARKDOWN)
    summary_lang: TextLanguage | None = Field(
        default=None, exclude_if=lambda value: value is None, description=LANGUAGE_MARKER
    )
    dates: ProjectionDates | None

    @computed_field(description="The summary as one line of plain text: a card shows it instead of rendering it.")
    @property
    def summary_text(self) -> str | None:
        return markdown_text(self.summary)
