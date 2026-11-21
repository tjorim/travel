"""Owner trip overview schemas: what a trip holds and what each audience receives."""

from datetime import date
from typing import Literal

from pydantic import Field

from app.models import DatePrecision
from app.schemas.base import ResponseModel


class OverviewRecordPrecision(ResponseModel):
    """How the records of one kind an audience receives read their dates."""

    by_precision: dict[DatePrecision, int]
    limited_by_record: int
    # Records that follow an audience which sets nothing, so they read by the month default.
    default_applied: int


class OverviewAudience(ResponseModel):
    """What one audience (the public page or a draft/active link) receives right now."""

    kind: Literal["public", "share_link"]
    id: str | None
    label: str
    state: str
    live: bool
    shares_title: bool
    shares_summary: bool
    dates_precision: DatePrecision | None
    # The audience's own cap on every date (null: it sets none, so each record's own value applies).
    date_precision: DatePrecision | None = None
    numbers: dict[str, int] = Field(
        default_factory=dict, description="Selected figures derived only from the audience projection."
    )
    # For visits and stays it delivers: how many read at each precision, and how many are held coarser than the
    # audience alone allows by their own setting. Keys are "visits" and "stays".
    record_precision: dict[str, OverviewRecordPrecision] = Field(default_factory=dict)
    scope_items: int
    # Hidden links and collection members only: how many `everyone` records it leaves out, and how many other
    # records it hides with them (by kind).
    excluded: int = 0
    excluded_also_hides: dict[str, int] = Field(default_factory=dict)
    delivered: dict[str, int]
    without_map_point: dict[str, int]
    shows_cover: bool = False
    # The sharing preset last applied here and how many records differ from it today (#241); a display label only.
    preset: str | None = None
    preset_exceptions: int = 0


class OverviewWarning(ResponseModel):
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
    # How many records or routes the warning counts (future transport and day dates); never their titles.
    count: int | None = None


class FutureDisclosure(ResponseModel):
    """Owner-only: what a candidate audience scope shows of the future before the trip starts, in counts.

    Both are zero when the trip has started or ended, or when nothing qualifies. Nothing is stored."""

    transport: int
    day_dates: int


class TripOverviewResponse(ResponseModel):
    """Owner-only: counts per kind, who receives what, and what to review before sharing."""

    trip_id: str
    title: str
    starts_on: date | None
    ends_on: date | None
    counts: dict[str, int]
    visibility: dict[str, dict[str, int]]
    audiences: list[OverviewAudience]
    warnings: list[OverviewWarning]
