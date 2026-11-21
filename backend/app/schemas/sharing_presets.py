"""Sharing preset catalog, request and review schemas."""

from datetime import date
from typing import Literal

from pydantic import Field

from app.models import DatePrecision
from app.schemas.audiences import ShareScopeKind
from app.schemas.base import InputModel, ResponseModel

SharingPresetId = Literal["story_only", "story_and_route", "planned_trip"]


class SharingPresetRequest(InputModel):
    """Which preset to review for one audience."""

    preset: SharingPresetId = Field(description="`story_only`, `story_and_route` or `planned_trip`.")


class SharingPresetApplyRequest(InputModel):
    """Apply a reviewed preset to one audience. The `fingerprint` must be the one the review returned."""

    preset: SharingPresetId = Field(description="`story_only`, `story_and_route` or `planned_trip`.")
    fingerprint: str = Field(
        min_length=1,
        max_length=64,
        description="The `fingerprint` of the review the owner accepted. If the records or the audience changed since, "
        "the apply is refused with 409 preset_preview_is_stale and a fresh review, and nothing changes.",
    )
    confirm_widening: bool = Field(
        default=False,
        description="Accept that a live audience newly receives the records the review lists as `widened`. Without it "
        "such an apply is refused with 409 preset_widening_needs_acknowledgement and nothing changes, not even the "
        "revision. A draft link, a draft collection and an unpublished page deliver nothing yet and need none. Not "
        "stored.",
    )


class SharingPresetKindRule(ResponseModel):
    kind: str = Field(description="A kind of record the preset selects.")
    statuses: list[str] | None = Field(
        description="Only records with one of these statuses; null accepts any. A record that cannot be shared yet "
        "is never selected."
    )


class SharingPresetDefinition(ResponseModel):
    id: SharingPresetId
    extends: SharingPresetId | None = Field(description="The smaller preset this one adds to.")
    selects: list[SharingPresetKindRule]
    photos: Literal["attached_to_included_updates"] = Field(
        description="Approved photo copies attached to the included updates travel with them; no other photo is chosen."
    )
    date_precision: Literal["month"] = Field(
        description="The audience's date cap becomes the coarser of its current value and this one."
    )


class SharingPresetCatalog(ResponseModel):
    schema_version: Literal["travel/sharing-preset@1"]
    presets: list[SharingPresetDefinition]


class PresetRecordRef(ResponseModel):
    kind: ShareScopeKind
    id: str
    label: str | None = Field(description="The owner's own name for the record. Owner-only; never audited.")
    day: date | None = Field(
        default=None, description="A stay's check-in day, so the interface can format it for the reader's locale."
    )


class PresetExceptions(ResponseModel):
    """How an audience differs now from what its last-applied preset would select today. Owner-only: it names records.

    These are not stored: they are computed from the records and the audience's scope each time, so a manual edit,
    a record created later and a deleted record are all reflected."""

    shown: list[PresetRecordRef] = Field(
        description="Records the audience receives that the preset would not select (an update you listed by hand, an "
        "`everyone` record outside the preset)."
    )
    hidden: list[PresetRecordRef] = Field(
        description="Records the preset would select that the audience does not receive (one you hid or left out, or "
        "a record created since)."
    )
    count: int = Field(description="`shown` plus `hidden`.")


class PresetChange(PresetRecordRef):
    action: Literal["promote", "list", "unlist", "exclude", "remove_exclusion"] = Field(
        description="`promote`: private becomes custom and is listed for this audience; `list`: a custom record is "
        "listed; `unlist`: a listed custom record the preset does not include is unlisted (it stays custom); "
        "`exclude`: an everyone record is left out of this hidden link or collection member; `remove_exclusion`: "
        "an exclusion that hides a record the preset includes is removed. A preset never writes everyone."
    )


class PresetLeftAsIs(PresetRecordRef):
    reason: Literal["everyone_on_public_view", "needed_by_included_records", "outside_preset"] = Field(
        description="`everyone_on_public_view`: the public view is the baseline and has no exclusions; "
        "`needed_by_included_records`: leaving it out would also hide a record the preset includes; "
        "`outside_preset`: a location or loose photo, which a preset never changes."
    )
    way_out: Literal["change_visibility", "exclude", "unlist"] = Field(
        description="How the owner changes it: set the record's own visibility (which changes every audience), "
        "leave it out of this hidden link or collection member, or unlist it from this audience's own list."
    )


class PresetNeedsDecision(PresetRecordRef):
    reason: str = Field(
        description="Why the preset does not sweep this record in: the code of the sharing blocker, or "
        "`share_time_is_on` for a visit that already shows its times."
    )


class PresetReplacesException(PresetRecordRef):
    reason: Literal["exclusion_removed", "left_out_by_you"] = Field(
        description="A choice the owner made by hand that applying the preset would reset: a record this link "
        "leaves out, or a custom record not listed for this audience."
    )


class PresetPrecisionReview(ResponseModel):
    before: DatePrecision | None = Field(description="The audience's date cap now; null means no cap.")
    after: DatePrecision
    changed: bool
    reads_coarser: dict[str, int] = Field(
        description="Records the audience receives both before and after whose date would read coarser, "
        "by `visit`, `stay`, `route` and `travel_update`. A preset never makes a date finer."
    )


class PresetComparison(ResponseModel):
    before: dict[str, int] = Field(description="Records the audience receives now, per kind.")
    after: dict[str, int] = Field(description="Records it would receive once the preset is applied, per kind.")
    added: dict[str, int]
    removed: dict[str, int]
    widened: list[PresetRecordRef] = Field(description="Records the audience would newly receive.")
    narrowed: list[PresetRecordRef] = Field(description="Records the audience would stop receiving.")


class PresetAudienceInfo(ResponseModel):
    id: str = Field(description="`public`, `link:<id>` or `collection:<member id>`.")
    kind: Literal["public", "link", "collection_member"]
    label: str | None = Field(description="The owner's link or collection label; null for the public page.")
    live: bool = Field(
        description="Whether this audience delivers today (a draft or unpublished page delivers nothing)."
    )


class PresetRefusal(ResponseModel):
    code: Literal["preset_too_large"]
    items: int
    exclude: int
    max_items: int
    max_exclude: int


class SharingPresetReview(ResponseModel):
    """What a preset would do for one audience, computed without writing anything.

    Owner-only. It names records, so it is never part of a visitor response or the audit trail."""

    schema_version: Literal["travel/sharing-preset@1"]
    preset: SharingPresetId
    audience: PresetAudienceInfo
    applicable: bool = Field(description="False when the plan is refused; see `refusal`.")
    refusal: PresetRefusal | None
    changes: list[PresetChange]
    change_counts: dict[str, int] = Field(description="The changes per action.")
    precision: PresetPrecisionReview
    comparison: PresetComparison | None = Field(description="Null when the plan is refused.")
    left_as_is: list[PresetLeftAsIs] = Field(
        description="Records outside the preset that the audience keeps receiving, with the way out."
    )
    needs_decision: list[PresetNeedsDecision]
    replaces_exceptions: list[PresetReplacesException]
    requires_acknowledgement: bool = Field(
        description="True when the audience is live and would newly receive records (the widening of decisions 27 "
        "and 36); applying then needs the owner's acknowledgement."
    )
    fingerprint: str = Field(
        description="A digest of this plan, for the step that applies it to detect a stale review."
    )
