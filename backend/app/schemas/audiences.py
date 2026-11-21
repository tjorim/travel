"""Share scope (audience) request and response schemas."""

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.models import DatePrecision
from app.schemas.base import InputModel, ResponseModel

# The most records one audience's scope may list (`items`) or leave out (`exclude`).
MAX_SCOPE_ITEMS = 200


MAX_SCOPE_EXCLUSIONS = 500


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


class ShareScopeDefaultsInput(InputModel):
    """Settings that apply to everything this audience receives."""

    date_precision: DatePrecision | None = Field(
        default=None,
        description="The finest date a visitor of this audience may read: day, month or year. It caps every "
        "record's date (and the trip dates) on top of the record's own setting, and the coarser of the two "
        "wins. null or absent sets no cap, so each record's own value applies (month when it has none).",
    )


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
    # Absent keeps what the audience has (a new audience reads by month); null removes every audience-level setting.
    defaults: ShareScopeDefaultsInput | None = None
    numbers: list[Literal["days", "areas", "countries", "nights"]] | None = Field(
        default=None,
        max_length=4,
        description="Opt-in visitor figures from the finished projection only: days with day-precise shared updates, "
        "explicit shared areas, countries in those areas and the union of day-precise shared stay nights. "
        "Never trip totals. Omitted preserves the stored choice; null or [] clears it. Presets preserve it.",
    )
    items: list[ShareScopeItemInput] = Field(default_factory=list, max_length=MAX_SCOPE_ITEMS)
    # Absent keeps the audience's stored exclusions (an older client that does not know the field can never widen an
    # audience); null or [] removes them all, which widens a live audience and needs confirm_widening.
    exclude: list[ShareScopeItemInput] | None = Field(
        default=None,
        max_length=MAX_SCOPE_EXCLUSIONS,
        description="Records set to everyone (the public baseline) that this hidden link or collection member does "
        "NOT receive, on top of its custom `items`. Each is removed from this audience only, together with the "
        "records that depend on it: an excluded area or location also hides the locations in it and the visits, "
        "stays, routes and updates that use it; an excluded update hides its photos; an excluded cover photo "
        "leaves this audience without a cover. Adding an exclusion narrows the audience; removing one on a live "
        "link or collection widens it and needs confirm_widening. The public view is the baseline and cannot "
        "exclude anything (422 scope_exclusion_not_allowed). An id not on this trip is refused; a record that is "
        "no longer set to everyone is dropped by the write. Absent keeps the stored exclusions; null or [] clears "
        "them. The response's `exclusions` names what each one also hides.",
    )

    def document(self, stored: dict | None = None) -> dict:
        """The scope as stored: ``defaults`` is kept only when it sets something.

        When this payload leaves ``defaults`` out, the audience's stored ``defaults`` carry over, so a client that
        does not know the setting (an older app or script) can never silently widen an audience. A new audience
        (``stored`` is ``None``) starts at the conservative ``month``; send ``defaults: null`` to set no cap."""
        document = self.model_dump(exclude={"defaults", "exclude", "numbers"})
        numbers = self.numbers if "numbers" in self.model_fields_set else (stored or {}).get("numbers")
        if numbers:
            document["numbers"] = sorted(set(numbers))
        chosen_exclusions: list[dict] = (
            [item.model_dump(mode="json") for item in self.exclude or []]
            if "exclude" in self.model_fields_set
            else list((stored or {}).get("exclude") or [])
        )
        if chosen_exclusions:
            document["exclude"] = chosen_exclusions
        if "defaults" in self.model_fields_set:
            chosen = self.defaults.model_dump(mode="json", exclude_none=True) if self.defaults is not None else {}
        elif stored is None:
            chosen = {"date_precision": DatePrecision.MONTH.value}
        else:
            chosen = stored.get("defaults") or {}
        if chosen:
            document["defaults"] = chosen
        return document


class ShareScopeTrip(ResponseModel):
    title: bool = True
    summary: bool = True
    dates: DatePrecision | None = None


class ShareScopeDefaults(ResponseModel):
    date_precision: DatePrecision | None = None


class ShareScopeItem(ResponseModel):
    kind: ShareScopeKind
    id: str


def _absent_when_none(value: object) -> bool:
    return value is None


class ShareScope(BaseModel):
    """What one audience receives, as stored. A setting the owner never made is absent rather than null."""

    @model_validator(mode="before")
    @classmethod
    def _fill_what_a_stored_scope_leaves_out(cls, value: object) -> object:
        # A stored scope may hold only what its owner set; the response always names these three.
        if isinstance(value, dict):
            return {"schema_version": "travel/share-scope@1", "trip": {}, "items": [], **value}
        return value

    schema_version: Literal["travel/share-scope@1"]
    trip: ShareScopeTrip
    defaults: ShareScopeDefaults | None = Field(
        default=None,
        exclude_if=_absent_when_none,
        description="The audience-level date cap. Absent when it sets none, so each record's own value applies.",
    )
    numbers: list[Literal["days", "areas", "countries", "nights"]] | None = Field(
        default=None, exclude_if=_absent_when_none, description="The opt-in visitor figures; absent when none."
    )
    items: list[ShareScopeItem]
    exclude: list[ShareScopeItem] | None = Field(
        default=None,
        exclude_if=_absent_when_none,
        description="Records set to everyone that this hidden link or collection member does not receive.",
    )
