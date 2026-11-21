"""Owner audit trail schemas."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models import AuditEventKind, AuditTargetType, Visibility
from app.schemas.audiences import ShareScopeItem, ShareScopeKind, _absent_when_none
from app.schemas.base import InputModel, ResponseModel
from app.schemas.precision import PrecisionCounts


class AuditReasonInput(InputModel):
    """An optional owner-entered reason attached to a lifecycle-transition
    audit event; never required, since most transitions are self-explanatory."""

    reason: str | None = Field(default=None, max_length=500)


class AuditPart(BaseModel):
    """A part of an event's details; it may carry counts or ids beyond the ones named."""

    model_config = ConfigDict(extra="allow")


class AuditChangedField(AuditPart):
    field: str
    audiences: list[str]


class AuditAudienceRef(AuditPart):
    audience: str


class AuditMergedRecord(AuditPart):
    id: str
    widened: list[AuditAudienceRef] | None = Field(default=None, exclude_if=_absent_when_none)


class AuditPrecisionAudience(AuditPart):
    audience: str
    widened: PrecisionCounts
    narrowed: PrecisionCounts


class AuditExclusionChange(AuditPart):
    added: list[ShareScopeItem]
    removed: list[ShareScopeItem]
    widened: dict[ShareScopeKind, int]


class AuditEventDetails(AuditPart):
    """What an event records, never authored content. Only the keys an event kind sets are present; the keys named
    here are the ones clients read, and an event may carry further ids or counts of its own."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    scope_version_before: str | None = Field(default=None, exclude_if=_absent_when_none)
    scope_version_after: str | None = Field(default=None, exclude_if=_absent_when_none)
    record_kind: ShareScopeKind | None = Field(default=None, exclude_if=_absent_when_none)
    from_: Visibility | None = Field(default=None, alias="from", exclude_if=_absent_when_none)
    to: Visibility | None = Field(default=None, exclude_if=_absent_when_none)
    newly_reached: list[str] | None = Field(default=None, exclude_if=_absent_when_none)
    no_longer_reached: list[str] | None = Field(default=None, exclude_if=_absent_when_none)
    changes: list[AuditChangedField] | dict[str, int] | None = Field(
        default=None,
        exclude_if=_absent_when_none,
        description="A `location.update`: the visitor-facing fields changed and the audience ids that read each. "
        "A sharing preset's apply: the number of changes per action.",
    )
    merged: list[AuditMergedRecord] | None = Field(
        default=None,
        exclude_if=_absent_when_none,
        description="A `location.merge` or `area.merge`: per duplicate, the audiences that newly read the kept record.",
    )
    changed: PrecisionCounts | None = Field(
        default=None,
        exclude_if=_absent_when_none,
        description="A `record.precision_follow_audience`: the records that now follow the audience.",
    )
    audiences: list[AuditPrecisionAudience] | None = Field(
        default=None,
        exclude_if=_absent_when_none,
        description="A `record.precision_follow_audience`: who reads those records differently.",
    )
    exclusions: AuditExclusionChange | None = Field(
        default=None,
        exclude_if=_absent_when_none,
        description="A live scope change that added or removed exclusions, and what removing them newly showed.",
    )
    others: Literal["cancel", "remove"] | None = Field(
        default=None,
        exclude_if=_absent_when_none,
        description="An `alternative_group.choose`: what happened to the other members.",
    )


class AuditEventResponse(ResponseModel):
    id: str
    kind: AuditEventKind
    target_type: AuditTargetType
    target_id: str
    occurred_at: datetime
    details: AuditEventDetails
    model_config = ConfigDict(from_attributes=True)
