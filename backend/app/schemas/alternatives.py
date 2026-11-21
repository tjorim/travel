"""Alternative group schemas."""

from datetime import date, datetime
from typing import Literal

from pydantic import ConfigDict, Field

from app.models import AlternativeGroupKind
from app.schemas.base import Identifier, InputModel, ResponseModel, SafeText
from app.schemas.routes import RouteResponse
from app.schemas.stays import StayResponse
from app.schemas.visits import VisitResponse


# Owner-only planning state: stays, visits or routes the owner is choosing between. No visitor
# response, projection, share scope or file ever embeds one of these.
class AlternativeGroupCreate(InputModel):
    kind: AlternativeGroupKind = Field(description="What the group compares; all members are of this kind.")
    member_ids: list[Identifier] = Field(
        min_length=2,
        max_length=20,
        description="Ids of the stays, visits or routes to compare. A record is in at most one group.",
    )
    label: SafeText | None = Field(default=None, min_length=1, max_length=160)


class AlternativeGroupUpdate(InputModel):
    non_nullable_fields = frozenset(["add_member_ids", "remove_member_ids"])

    label: SafeText | None = Field(default=None, min_length=1, max_length=160, description="null clears the label.")
    add_member_ids: list[Identifier] | None = Field(default=None, max_length=20)
    remove_member_ids: list[Identifier] | None = Field(default=None, max_length=20)


class AlternativeChoose(InputModel):
    member_id: Identifier = Field(description="The id of the stay, visit or route to choose.")
    others: Literal["cancel", "remove"] = Field(
        default="cancel",
        description=(
            "What happens to the other members: `cancel` marks them cancelled (undoable); `remove` deletes "
            "their records for good (not undoable)."
        ),
    )


class AlternativeUndo(InputModel):
    event_id: Identifier | None = Field(
        default=None,
        description="The `event_id` of the choice to undo; refused when a newer choice replaced it.",
    )


class AlternativeMemberResponse(ResponseModel):
    record_id: str
    chosen: bool
    stay: StayResponse | None = None
    visit: VisitResponse | None = None
    route: RouteResponse | None = None
    model_config = ConfigDict(from_attributes=True)


class AlternativeGroupResponse(ResponseModel):
    id: str
    kind: AlternativeGroupKind
    label: str | None
    chosen_id: str | None = Field(description="The record id of the chosen member; null while undecided.")
    members: list[AlternativeMemberResponse]
    created_at: datetime
    updated_at: datetime


class AlternativeSuggestion(ResponseModel):
    """Ideas that look like alternatives. Nothing is stored until the owner confirms the group."""

    kind: AlternativeGroupKind
    member_ids: list[str]
    starts_on: date | None = Field(description="The first day or night the members cover; null when unknown.")
    ends_on: date | None = Field(description="The last day or the check-out day the members cover.")
    reason: Literal["overlapping_nights", "overlapping_days", "same_journey"]
    model_config = ConfigDict(from_attributes=True)


class AlternativeChoiceResponse(ResponseModel):
    group: AlternativeGroupResponse
    event_id: str
    chosen_id: str
    cancelled_ids: list[str]
    removed_ids: list[str]
    undoable: bool = Field(description="False after `others: remove`: the removed records cannot be restored.")
