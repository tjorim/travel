"""Location request and response schemas."""

from typing import Literal

from pydantic import ConfigDict, Field, computed_field, field_validator, model_validator
from pydantic_core import PydanticCustomError

from app.models import Visibility
from app.schemas.areas import AreaInput
from app.schemas.base import (
    COUNTRY_CODE_FIELD,
    DUTCH_TEXT,
    ENGLISH_TEXT,
    LOCAL_NAME,
    MARKDOWN,
    PLAIN_TEXT,
    Identifier,
    InputModel,
    TextLanguage,
    _html,
    _html_of,
    blank_to_none,
)

from .localized import TranslationFreshness


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
    label: str | None = Field(default=None, max_length=120, description=PLAIN_TEXT)
    label_nl: str | None = Field(default=None, max_length=120, description=DUTCH_TEXT)
    label_en: str | None = Field(default=None, max_length=120, description=ENGLISH_TEXT)
    local_name: str | None = Field(default=None, max_length=120, description=LOCAL_NAME)
    # The area the location belongs to. Left out, it is derived from the location's city.
    area_id: Identifier | None = Field(default=None, min_length=1, max_length=32)
    # Show the address too when the location is shared. Off unless the owner chooses it.
    share_address: bool = False

    _local_name = field_validator("local_name")(blank_to_none)

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

    existing_location_id: Identifier | None = Field(default=None, min_length=1, max_length=32)
    new_area: AreaInput | None = None

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


def require_identified_location(location: LocationInput | None) -> LocationInput | None:
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

    non_nullable_fields = frozenset(["share_address", "acknowledge_visitor_changes"])

    label: str | None = Field(default=None, max_length=120, description=PLAIN_TEXT)
    label_nl: str | None = Field(default=None, max_length=120, description=DUTCH_TEXT)
    label_en: str | None = Field(default=None, max_length=120, description=ENGLISH_TEXT)
    label_reviewed: TextLanguage | None = Field(
        default=None, description="Confirm that this language version is still correct."
    )
    local_name: str | None = Field(default=None, max_length=120, description=LOCAL_NAME)
    area_id: Identifier | None = Field(default=None, min_length=1, max_length=32)
    share_address: bool | None = None
    display_name: str | None = Field(default=None, max_length=500)
    address_line1: str | None = Field(default=None, max_length=160)
    address_line2: str | None = Field(default=None, max_length=160)
    locality: str | None = Field(default=None, max_length=120)
    admin_area: str | None = Field(default=None, max_length=120)
    postal_code: str | None = Field(default=None, max_length=20)
    country_code: str | None = COUNTRY_CODE_FIELD
    notes: str | None = Field(default=None, max_length=2000, description=MARKDOWN)
    acknowledge_visitor_changes: bool = Field(
        default=False,
        description=(
            "Set to true to accept that this edit changes what the location's live audiences read: its public name, "
            "city, country, shared address, or an area move that carries visits and route ends. Without it such an "
            "edit is refused with 409, listing each field's before and after and the audiences. Not stored."
        ),
    )
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

    _local_name = field_validator("local_name")(blank_to_none)

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


class LocationResponse(LocationFields):
    translation_freshness: dict[str, TranslationFreshness] = Field(default_factory=dict)
    id: str
    visibility: Visibility
    # Every stored location belongs to an area (derived from its city when it was created).
    area_id: str  # ty: ignore[incompatible-mutable-override]
    osm_url: str | None
    # A response is read from stored data, not sent by a client.
    model_config = ConfigDict(from_attributes=True, extra="ignore", json_schema_serialization_defaults_required=True)

    @computed_field(description=_html_of("notes"))
    @property
    def notes_html(self) -> str | None:
        return _html(self.notes)
