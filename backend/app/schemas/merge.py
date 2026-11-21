"""Merging duplicate locations and areas: request, widening and result schemas."""

from datetime import date
from typing import Literal

from pydantic import Field

from app.schemas.base import Identifier, InputModel, ResponseModel


class MergeRecordRef(InputModel):
    """One stay, visit, route or update a merge would show to more visitors, named by kind and id."""

    kind: Literal["stay", "visit", "route", "travel_update"]
    id: Identifier = Field(min_length=1, max_length=32)


class MergeRequest(InputModel):
    """Fold duplicate locations or areas into ``keep_id``. Without ``confirm`` it only previews."""

    keep_id: Identifier = Field(min_length=1, max_length=32)
    duplicate_ids: list[Identifier] = Field(min_length=1, max_length=50)
    confirm: bool = False
    confirm_widening: bool = Field(
        default=False,
        description=(
            "Set to true, together with confirm, to accept that the merge shows visitors more: a live audience "
            "that receives the kept record but not a duplicate starts to read the kept place (its name and point, "
            "or an area's rounded point) through the stays, visits, routes and updates that move. Without it such "
            "a confirmed merge is refused with 409 and nothing changes. Not stored."
        ),
    )
    make_private: list[MergeRecordRef] = Field(
        default_factory=list,
        max_length=500,
        description=(
            "Stays, visits, routes and updates the preview lists as newly shown (`widened_records`) that the merge "
            "makes private first, so they follow the merge hidden from every audience instead of showing more. "
            "Each is an explicit choice: a record the preview does not list is refused with 409 and nothing changes. "
            "A chosen record no longer needs confirm_widening. Making it private also removes it from custom scopes."
        ),
    )


class MergeAudience(ResponseModel):
    """A live audience of the trip: the public page or one active share link."""

    audience: str = Field(description="`public` or `link:<id>`.")
    label: str | None = Field(description="The share link's label; none for the public page.")


class MergeWidening(MergeAudience):
    """A live audience that newly reads the kept record, and how many moved records show it to them."""

    stays: int = 0
    visits: int = 0
    routes: int = 0
    travel_updates: int = 0


class MergeWidenedRecord(ResponseModel):
    """A moved record that newly reaches an audience, and what making it private would do instead."""

    kind: Literal["stay", "visit", "route", "travel_update"]
    id: str
    label: str | None = Field(description="The record's own title, name or property, when it has one.")
    starts_on: date | None = Field(description="Its start date, to tell records of one kind apart.")
    visibility: Literal["everyone", "custom"]
    widened_for: list[MergeAudience] = Field(description="The audiences that newly read the kept place through it.")
    hides_from: list[MergeAudience] = Field(
        description="Audiences that read it today and lose it entirely when it is made private."
    )
    custom_picks: int = Field(description="Custom scopes listing it; making it private removes it from them for good.")
    make_private: bool = Field(description="Whether this request chose to make it private first.")


class LocationMergeDuplicate(ResponseModel):
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
    # Live audiences that receive the kept location but not this duplicate, so
    # the moved records start to show them the kept place (see ``confirm_widening``).
    widened: list[MergeWidening] = []
    widened_records: list[MergeWidenedRecord] = []


class LocationMergeResult(ResponseModel):
    keep_id: str
    applied: bool
    duplicates: list[LocationMergeDuplicate]
    warnings: list[str]


class AreaMergeDuplicate(ResponseModel):
    """What merging one duplicate area moves to the kept area, and what it may hide."""

    id: str
    label: str | None
    locations: int
    visits: int
    stays: int
    routes: int
    travel_updates: int
    narrowed_audiences: list[str]
    # Live audiences that receive the kept area but not this duplicate, so the
    # moved records start to show them the kept area's rounded point.
    widened: list[MergeWidening] = []
    widened_records: list[MergeWidenedRecord] = []


class AreaMergeResult(ResponseModel):
    keep_id: str
    applied: bool
    duplicates: list[AreaMergeDuplicate]
    # Locations in the merged area that only name the city, and so are likely
    # duplicates of each other: candidates for merge_locations.
    city_level_location_ids: list[str]
    warnings: list[str]
