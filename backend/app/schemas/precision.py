"""Bulk date-precision (follow the audience) schemas."""

from typing import Literal

from pydantic import Field

from app.schemas.base import InputModel, ResponseModel


def _both_precision_kinds() -> list[Literal["visit", "stay"]]:
    return ["visit", "stay"]


class FollowAudiencePrecisionRequest(InputModel):
    """Let visits and stays follow each audience's date precision instead of their own setting.

    Every selected record that has its own ``share_date_precision`` is set to null. Without ``confirm`` it only
    previews."""

    non_nullable_fields = frozenset(["kinds", "confirm", "confirm_widening"])

    kinds: list[Literal["visit", "stay"]] = Field(
        default_factory=_both_precision_kinds,
        min_length=1,
        max_length=2,
        description="Which records follow the audience: visit, stay or both (the default).",
    )
    confirm: bool = False
    confirm_widening: bool = Field(
        default=False,
        description=(
            "Set to true, together with confirm, to accept that a live audience starts to read finer dates: a record "
            "held to a coarser precision by its own setting then follows an audience that allows more. Without it "
            "such a confirmed change is refused with 409 and nothing changes. Not stored."
        ),
    )


class PrecisionCounts(ResponseModel):
    visits: int = 0
    stays: int = 0


class FollowAudienceAudience(ResponseModel):
    """A live audience whose dates change: the records it receives that read finer, or coarser, afterwards."""

    audience: str = Field(description="`public`, `link:<id>` or `collection:<id>`.")
    label: str | None = Field(description="The owner's link or collection label; null for the public page.")
    widened: PrecisionCounts
    narrowed: PrecisionCounts


class FollowAudiencePrecisionResult(ResponseModel):
    applied: bool
    # The records that follow the audience afterwards, and that had their own value before.
    changed: PrecisionCounts
    audiences: list[FollowAudienceAudience]
