"""Owner-only review and apply of a sharing preset for one audience (#241).

Thin routes over ``app.services.sharing_presets``, which the MCP tools call too: the review stores nothing, and the
apply writes the plan in one transaction that each route commits."""

from typing import Annotated

from fastapi import APIRouter, Depends, Header
from sqlalchemy.orm import Session

from ..auth import current_subject
from ..database import get_session
from ..schemas import (
    Identifier,
    LinkPresetApplyResult,
    MemberPresetApplyResult,
    PublicPresetApplyResult,
    SharingPresetApplyRequest,
    SharingPresetCatalog,
    SharingPresetRequest,
    SharingPresetReview,
)
from ..services import sharing_presets as service

router = APIRouter(tags=["publication"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]


@router.get("/trips/{trip_id}/sharing-presets", response_model=SharingPresetCatalog)
def list_sharing_presets(trip_id: Identifier, session: SessionDep, subject: SubjectDep) -> SharingPresetCatalog:
    return service.preset_catalog_response(session, subject, trip_id)


@router.post("/trips/{trip_id}/public-projection/preset/review", response_model=SharingPresetReview)
def review_public_preset(
    trip_id: Identifier, payload: SharingPresetRequest, session: SessionDep, subject: SubjectDep
) -> SharingPresetReview:
    return service.review_sharing_preset(session, subject, trip_id, "public", payload)


@router.post("/trips/{trip_id}/share-links/{link_id}/preset/review", response_model=SharingPresetReview)
def review_link_preset(
    trip_id: Identifier, link_id: Identifier, payload: SharingPresetRequest, session: SessionDep, subject: SubjectDep
) -> SharingPresetReview:
    return service.review_sharing_preset(session, subject, trip_id, f"link:{link_id}", payload)


@router.post("/collections/{collection_id}/members/{member_id}/preset/review", response_model=SharingPresetReview)
def review_collection_member_preset(
    collection_id: Identifier,
    member_id: Identifier,
    payload: SharingPresetRequest,
    session: SessionDep,
    subject: SubjectDep,
) -> SharingPresetReview:
    return service.review_member_preset(session, subject, collection_id, member_id, payload)


@router.post("/trips/{trip_id}/public-projection/preset", response_model=PublicPresetApplyResult)
def apply_public_preset(
    trip_id: Identifier,
    payload: SharingPresetApplyRequest,
    session: SessionDep,
    subject: SubjectDep,
    if_match: Annotated[str | None, Header()] = None,
) -> PublicPresetApplyResult:
    result = service.apply_sharing_preset(session, subject, trip_id, "public", payload, if_match)
    session.commit()
    assert isinstance(result, PublicPresetApplyResult)
    return result


@router.post("/trips/{trip_id}/share-links/{link_id}/preset", response_model=LinkPresetApplyResult)
def apply_link_preset(
    trip_id: Identifier,
    link_id: Identifier,
    payload: SharingPresetApplyRequest,
    session: SessionDep,
    subject: SubjectDep,
    if_match: Annotated[str | None, Header()] = None,
) -> LinkPresetApplyResult:
    result = service.apply_sharing_preset(session, subject, trip_id, f"link:{link_id}", payload, if_match)
    session.commit()
    assert isinstance(result, LinkPresetApplyResult)
    return result


@router.post("/collections/{collection_id}/members/{member_id}/preset", response_model=MemberPresetApplyResult)
def apply_collection_member_preset(
    collection_id: Identifier,
    member_id: Identifier,
    payload: SharingPresetApplyRequest,
    session: SessionDep,
    subject: SubjectDep,
    if_match: Annotated[str | None, Header()] = None,
) -> MemberPresetApplyResult:
    result = service.apply_member_preset(session, subject, collection_id, member_id, payload, if_match)
    session.commit()
    return result
