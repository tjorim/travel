"""Place search and navigation schemas."""

from typing import Literal

from pydantic import Field

from app.schemas.base import COUNTRY_CODE_FIELD, InputModel, ResponseModel


class PlaceSearchRequest(InputModel):
    query: str = Field(min_length=2, max_length=200)


class PlaceReverseGeocodeRequest(InputModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class PlaceSearchResult(ResponseModel):
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
    local_name: str | None = Field(
        default=None,
        description="The provider's own name for the place, as written where it is, when that differs from the "
        "English name in `display_name`. Offered as `local_name`; saved only if the owner keeps it.",
    )
    name_nl: str | None = Field(
        default=None,
        description="The provider's Dutch name (`name:nl`): a suggestion for `label_nl`, never saved by itself.",
    )
    name_en: str | None = Field(
        default=None,
        description="The provider's English name (`name:en`): a suggestion for `label_en`, never saved by itself.",
    )
    viewport_north: float | None = Field(default=None, ge=-90, le=90)
    viewport_south: float | None = Field(default=None, ge=-90, le=90)
    viewport_east: float | None = Field(default=None, ge=-180, le=180)
    viewport_west: float | None = Field(default=None, ge=-180, le=180)


class PlaceSearchResponse(ResponseModel):
    provider: str
    attribution: str
    attribution_url: str
    results: list[PlaceSearchResult]


class NavigationResponse(ResponseModel):
    """Only returned to the owner. Shared navigation redirects directly."""

    url: str
    exact: bool
