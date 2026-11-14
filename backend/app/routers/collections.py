"""Collection links: one owner-wide capability that opens several trips.

The owner routes are thin: ``app.services.collections`` holds the operations, shared with the MCP tools, and each
route commits once. Anonymous delivery of a collection's trips stays here because it is HTTP only.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, Request, Response, status
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy.orm import Session

from ..audience import MemberAudience
from ..auth import current_subject
from ..database import get_session
from ..errors import ApiException
from ..http_delivery import (
    file_response,
    persist_lazy_expiry,
    preview_navigation,
    reject_malformed_token,
    validate_public_path,
)
from ..models import CollectionAuditEvent, CollectionMember, Trip
from ..projection import scoped_navigation_url
from ..ratelimit import shared_delivery_limit
from ..schemas import (
    AuditReasonInput,
    CollectionAuditEventResponse,
    CollectionCreate,
    CollectionIndexDocument,
    CollectionMemberCreate,
    CollectionMembershipResponse,
    CollectionResponse,
    CollectionUpdate,
    ExclusionWideningConflict,
    FutureDisclosure,
    Identifier,
    ProjectionDocument,
    SafeText,
    ShareLinkActivateRequest,
    ShareScopeInput,
)
from ..services import collections as service
from ..services.audiences import render_document
from ..services.delivery import UNLISTED_HEADERS
from ..services.sharing import active_collection
from ..services.trips import trip_query
from ..storage import ObjectStorage, get_storage

router = APIRouter(prefix="/collections", tags=["collections"])
delivery_router = APIRouter(tags=["sharing-delivery"], dependencies=[Depends(validate_public_path)])
membership_router = APIRouter(prefix="/trips/{trip_id}", tags=["collections"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]
StorageDep = Annotated[ObjectStorage, Depends(get_storage)]


# --- Owner -----------------------------------------------------------------------


@router.post("", response_model=CollectionResponse, status_code=status.HTTP_201_CREATED)
def create_collection(payload: CollectionCreate, session: SessionDep, subject: SubjectDep) -> CollectionResponse:
    result = service.create_collection(session, subject, payload)
    session.commit()
    return result


@router.get("/audit-events", response_model=list[CollectionAuditEventResponse])
def list_collection_audit_events(session: SessionDep, subject: SubjectDep) -> list[CollectionAuditEvent]:
    return service.list_collection_audit_events(session, subject)


@router.get("", response_model=list[CollectionResponse])
def list_collections(session: SessionDep, subject: SubjectDep) -> list[CollectionResponse]:
    result = service.list_collections(session, subject)
    session.commit()
    return result


@router.get("/{collection_id}", response_model=CollectionResponse)
def get_collection(collection_id: Identifier, session: SessionDep, subject: SubjectDep) -> CollectionResponse:
    result = service.get_collection(session, subject, collection_id)
    session.commit()
    return result


@router.patch("/{collection_id}", response_model=CollectionResponse)
def update_collection(
    collection_id: Identifier, payload: CollectionUpdate, session: SessionDep, subject: SubjectDep
) -> CollectionResponse:
    result = service.update_collection(session, subject, collection_id, payload)
    session.commit()
    return result


@router.delete("/{collection_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_collection(collection_id: Identifier, session: SessionDep, subject: SubjectDep) -> Response:
    service.delete_collection(session, subject, collection_id)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{collection_id}/members", response_model=CollectionResponse, status_code=status.HTTP_201_CREATED)
def add_collection_member(
    collection_id: Identifier, payload: CollectionMemberCreate, session: SessionDep, subject: SubjectDep
) -> CollectionResponse:
    result = service.add_collection_member(session, subject, collection_id, payload)
    session.commit()
    return result


@router.put(
    "/{collection_id}/members/{member_id}",
    response_model=CollectionResponse,
    responses={409: {"model": ExclusionWideningConflict, "description": "A live audience would newly show records."}},
)
def set_collection_member_scope(
    collection_id: Identifier,
    member_id: Identifier,
    payload: ShareScopeInput,
    session: SessionDep,
    subject: SubjectDep,
    if_match: Annotated[str | None, Header()] = None,
    confirm_widening: Annotated[
        bool,
        Query(
            description="Accept that removing exclusions from an active collection shows its visitors records they "
            "did not receive. Without it such a change is refused with 409 exclusion_widening_needs_acknowledgement, "
            "which lists the records, and nothing changes. Not stored."
        ),
    ] = False,
) -> CollectionResponse:
    result = service.set_collection_member_scope(
        session, subject, collection_id, member_id, payload, if_match, confirm_widening
    )
    session.commit()
    return result


@router.delete("/{collection_id}/members/{member_id}", response_model=CollectionResponse)
def remove_collection_member(
    collection_id: Identifier, member_id: Identifier, session: SessionDep, subject: SubjectDep
) -> CollectionResponse:
    result = service.remove_collection_member(session, subject, collection_id, member_id)
    session.commit()
    return result


@router.post("/{collection_id}/members/{member_id}/preview", response_model=ProjectionDocument)
def preview_collection_member(
    collection_id: Identifier,
    member_id: Identifier,
    session: SessionDep,
    subject: SubjectDep,
    response: Response,
    payload: ShareScopeInput | None = None,
) -> dict:
    document = service.preview_collection_member(session, subject, collection_id, member_id, payload)
    persist_lazy_expiry(session)
    response.headers["Cache-Control"] = "no-store"
    return document


@router.post("/{collection_id}/members/{member_id}/future-disclosure", response_model=FutureDisclosure)
def review_collection_member_future(
    collection_id: Identifier,
    member_id: Identifier,
    session: SessionDep,
    subject: SubjectDep,
    payload: ShareScopeInput | None = None,
) -> FutureDisclosure:
    """The same review as a hidden link's, for a collection member's candidate scope. Stores nothing."""
    result = service.review_member_future(session, subject, collection_id, member_id, payload)
    persist_lazy_expiry(session)
    return result


@router.post("/{collection_id}/members/{member_id}/preview/files/{local_id}")
def preview_collection_member_file(
    collection_id: Identifier,
    member_id: Identifier,
    local_id: SafeText,
    session: SessionDep,
    subject: SubjectDep,
    storage: StorageDep,
    request: Request,
    payload: ShareScopeInput | None = None,
) -> Response:
    trip, scope = service.member_preview(session, subject, collection_id, member_id, payload)
    persist_lazy_expiry(session)
    return file_response(trip, scope, local_id, storage, UNLISTED_HEADERS, request)


@router.get("/{collection_id}/members/{member_id}/preview/files/{local_id}")
def preview_collection_member_saved_file(
    collection_id: Identifier,
    member_id: Identifier,
    local_id: SafeText,
    session: SessionDep,
    subject: SubjectDep,
    storage: StorageDep,
    request: Request,
) -> Response:
    return preview_collection_member_file(collection_id, member_id, local_id, session, subject, storage, request, None)


@router.post("/{collection_id}/members/{member_id}/preview/navigation/{local_id}")
def preview_collection_member_navigation(
    collection_id: Identifier,
    member_id: Identifier,
    local_id: SafeText,
    session: SessionDep,
    subject: SubjectDep,
    payload: ShareScopeInput | None = None,
) -> JSONResponse:
    trip, scope = service.member_preview(session, subject, collection_id, member_id, payload)
    persist_lazy_expiry(session)
    return preview_navigation(trip, scope, local_id)


@router.get("/{collection_id}/members/{member_id}/preview/navigation/{local_id}")
def preview_collection_member_saved_navigation(
    collection_id: Identifier, member_id: Identifier, local_id: SafeText, session: SessionDep, subject: SubjectDep
) -> JSONResponse:
    return preview_collection_member_navigation(collection_id, member_id, local_id, session, subject, None)


@router.get("/{collection_id}/preview", response_model=CollectionIndexDocument)
def preview_collection_index(
    collection_id: Identifier, session: SessionDep, subject: SubjectDep, response: Response
) -> CollectionIndexDocument:
    """The index exactly as a visitor of this collection would receive it."""
    result = service.preview_collection_index(session, subject, collection_id)
    persist_lazy_expiry(session)
    response.headers["Cache-Control"] = "no-store"
    return result


@router.post("/{collection_id}/activate", response_model=CollectionResponse)
def activate_collection(
    collection_id: Identifier, payload: ShareLinkActivateRequest, session: SessionDep, subject: SubjectDep
) -> CollectionResponse:
    result = service.activate_collection(session, subject, collection_id, payload)
    session.commit()
    return result


@router.post("/{collection_id}/revoke", response_model=CollectionResponse)
def revoke_collection(
    collection_id: Identifier,
    session: SessionDep,
    subject: SubjectDep,
    payload: AuditReasonInput = AuditReasonInput(),
) -> CollectionResponse:
    result = service.revoke_collection(session, subject, collection_id, payload)
    session.commit()
    return result


@router.post("/{collection_id}/rotate", response_model=CollectionResponse)
def rotate_collection(
    collection_id: Identifier, payload: ShareLinkActivateRequest, session: SessionDep, subject: SubjectDep
) -> CollectionResponse:
    """Replace the capability in place: the old token stops working, members and scopes stay."""
    result = service.rotate_collection(session, subject, collection_id, payload)
    session.commit()
    return result


@membership_router.get("/collections", response_model=list[CollectionMembershipResponse])
def list_trip_collections(
    trip_id: Identifier, session: SessionDep, subject: SubjectDep
) -> list[CollectionMembershipResponse]:
    """Which collections reach this trip, so the owner sees every way it can be opened."""
    result = service.list_trip_collections(session, subject, trip_id)
    session.commit()
    return result


# --- Anonymous delivery ----------------------------------------------------------


def _member_of_active_collection(
    session: Session, token: str, member_id: str, not_found: ApiException
) -> tuple[Trip, CollectionMember]:
    collection = active_collection(session, token)
    persist_lazy_expiry(session)
    if collection is None:
        raise not_found
    member = next((item for item in collection.members if item.id == member_id), None)
    trip = session.scalar(trip_query().where(Trip.id == member.trip_id)) if member is not None else None
    if member is None or trip is None:
        raise not_found
    return trip, member


@delivery_router.get(
    "/shared/{token}/trips/{member_id}",
    response_model=ProjectionDocument,
    dependencies=[Depends(shared_delivery_limit)],
)
def get_shared_collection_trip(
    request: Request, token: str, member_id: str, session: SessionDep, response: Response
) -> dict:
    not_found = ApiException(
        status_code=status.HTTP_404_NOT_FOUND, detail="Link not found", headers=UNLISTED_HEADERS, code="not_found"
    )
    reject_malformed_token(request, not_found)
    trip, member = _member_of_active_collection(session, token, member_id, not_found)
    for header, value in UNLISTED_HEADERS.items():
        response.headers[header] = value
    return render_document(session, MemberAudience(member), trip, member.scope)


@delivery_router.get(
    "/shared/{token}/trips/{member_id}/navigation/{local_id}",
    status_code=status.HTTP_302_FOUND,
    dependencies=[Depends(shared_delivery_limit)],
)
def get_shared_collection_navigation(
    request: Request, token: str, member_id: str, local_id: str, session: SessionDep
) -> RedirectResponse:
    not_found = ApiException(
        status_code=status.HTTP_404_NOT_FOUND, detail="Link not found", headers=UNLISTED_HEADERS, code="not_found"
    )
    reject_malformed_token(request, not_found)
    trip, member = _member_of_active_collection(session, token, member_id, not_found)
    target = scoped_navigation_url(trip, member.scope, local_id)
    if target is None:
        raise ApiException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Navigation target not found",
            headers=UNLISTED_HEADERS,
            code="not_found",
        )
    return RedirectResponse(target, status_code=status.HTTP_302_FOUND, headers=UNLISTED_HEADERS)


@delivery_router.get(
    "/shared/{token}/trips/{member_id}/files/{local_id}", dependencies=[Depends(shared_delivery_limit)]
)
def get_shared_collection_file(
    request: Request, token: str, member_id: str, local_id: str, session: SessionDep, storage: StorageDep
) -> Response:
    not_found = ApiException(
        status_code=status.HTTP_404_NOT_FOUND, detail="File not found", headers=UNLISTED_HEADERS, code="not_found"
    )
    reject_malformed_token(request, not_found)
    trip, member = _member_of_active_collection(session, token, member_id, not_found)
    return file_response(trip, member.scope, local_id, storage, UNLISTED_HEADERS, request)
