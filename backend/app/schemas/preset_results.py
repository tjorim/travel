"""What applying a sharing preset returns for each kind of audience."""

from pydantic import Field

from app.schemas.base import ResponseModel
from app.schemas.collections import CollectionMemberResponse
from app.schemas.publication import PublicProjectionStatusResponse, ShareLinkResponse
from app.schemas.sharing_presets import SharingPresetReview


class SharingPresetApplyResult(ResponseModel):
    """What an apply did. `applied` is false when the audience already matched: nothing was written, no revision was
    claimed and no audit event was recorded."""

    applied: bool
    review: SharingPresetReview = Field(description="The plan that was applied (or found to be empty).")


class PublicPresetApplyResult(SharingPresetApplyResult):
    audience: PublicProjectionStatusResponse


class LinkPresetApplyResult(SharingPresetApplyResult):
    audience: ShareLinkResponse


class MemberPresetApplyResult(SharingPresetApplyResult):
    audience: CollectionMemberResponse
