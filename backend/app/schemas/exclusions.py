"""Exclusion review and widening schemas."""

from typing import Literal

from pydantic import Field

from app.schemas.audiences import ShareScopeItemInput, ShareScopeKind
from app.schemas.base import InputModel, ResponseModel


class ExclusionRef(ResponseModel):
    kind: ShareScopeKind
    id: str


KIND_COUNTS = (
    "How many records of each kind (area, location, visit, stay, route, travel_update, media_derivative), "
    "only kinds with at least one."
)


class ExcludedRecord(ExclusionRef):
    """One record an audience excludes, and the records that depend on it, hidden from this audience as well."""

    received: bool = Field(
        description="Whether this audience would receive the record without the exclusion. False for a record "
        "that cannot be shared right now (for example a cancelled visit); the exclusion still holds if it can again."
    )
    hides: dict[str, int] = Field(
        description="What the exclusion also hides from this audience: "
        + KIND_COUNTS
        + " Only records the audience would otherwise receive are counted."
    )
    also_hides: list[ExclusionRef] = Field(description="The same records, by kind and id.")


class ScopeExclusions(ResponseModel):
    """What a hidden link or collection member leaves out of the public baseline, and what that also hides."""

    excluded: list[ExcludedRecord] = Field(default_factory=list, description="The exclusions that apply.")
    also_hidden: dict[str, int] = Field(
        default_factory=dict,
        description="All records hidden only because they depend on an exclusion, taken together: " + KIND_COUNTS,
    )
    stale: int = Field(
        default=0,
        description="Stored exclusions that no longer apply (the record was deleted or is no longer set to "
        "everyone). They are ignored and dropped by the next write.",
    )


class ExclusionReview(ScopeExclusions):
    """A scope's exclusions plus every record the public baseline reaches, which an audience may exclude."""

    baseline: list[ExclusionRef] = Field(
        description="Records an exclusion can name: those set to everyone that can be shared, and photos that "
        "travel with a shared update."
    )


class ExclusionReviewRequest(InputModel):
    """Which exclusions to review. Nothing is stored."""

    exclude: list[ShareScopeItemInput] = Field(default_factory=list, max_length=500)
    items: list[ShareScopeItemInput] = Field(
        default_factory=list,
        max_length=200,
        description="The audience's custom selection, so that what an exclusion also hides counts the records "
        "this audience would really receive.",
    )


class ExclusionWidening(ResponseModel):
    """The records that removing exclusions from a scope would newly show its audience."""

    revealed: list[ExclusionRef] = Field(default_factory=list)
    counts: dict[str, int] = Field(default_factory=dict, description=KIND_COUNTS)


class ExclusionWideningDetail(ExclusionWidening):
    """The `detail` of the 409 that refuses a live audience's save until the owner acknowledges the widening."""

    code: Literal["exclusion_widening_needs_acknowledgement"]


class ExclusionWideningConflict(ResponseModel):
    detail: ExclusionWideningDetail
