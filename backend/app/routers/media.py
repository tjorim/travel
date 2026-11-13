"""Trip media routes and the owner's provider connections.

The media routes are thin: ``app.services.media`` holds the operations, shared with the MCP tools. Each route
commits once; the object-storage lifecycle (``docs/object-storage.md``) is kept around that commit: uploads write
their bytes before it, and a removal finalises its purge only after it.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, File, Request, Response, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..auth import current_subject
from ..database import get_session
from ..errors import ApiException, service_exception
from ..media import oauth
from ..media.providers import ProviderUnavailableError, get_provider_resolver, provider_available
from ..media.ranges import media_response, private_original_headers
from ..media.service import ProviderResolver
from ..models import ImportProvider
from ..schemas import (
    ImportSessionCompleteResponse,
    ImportSessionResponse,
    InputModel,
    MediaAssetResponse,
    MediaDerivativeCreate,
    MediaDerivativePresentationUpdate,
    MediaDerivativeResponse,
    MediaTravelUpdateCandidatesRequest,
    MediaTravelUpdateCandidatesResponse,
    OAuthStartResponse,
    ProviderConnectionStatus,
)
from ..secrets import SecretStore, get_secret_store
from ..services import media as service
from ..storage import ObjectStorage, get_storage

router = APIRouter(prefix="/trips/{trip_id}/media", tags=["media"])
provider_tokens_router = APIRouter(prefix="/provider-tokens", tags=["media"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]
StorageDep = Annotated[ObjectStorage, Depends(get_storage)]
SecretStoreDep = Annotated[SecretStore, Depends(get_secret_store)]
ProviderResolverDep = Annotated[ProviderResolver, Depends(get_provider_resolver)]


# --- Direct device upload: the durable fallback, always available -----------------


@router.post("/uploads", response_model=MediaAssetResponse)
def upload_media(
    trip_id: str,
    session: SessionDep,
    subject: SubjectDep,
    storage: StorageDep,
    response: Response,
    file: Annotated[UploadFile, File()],
) -> MediaAssetResponse:
    uploaded, created = service.upload_media(
        session,
        storage,
        subject,
        trip_id,
        filename=file.filename,
        content_type=file.content_type,
        file=file.file,
    )
    session.commit()
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return uploaded


@router.get("", response_model=list[MediaAssetResponse])
def list_media(trip_id: str, session: SessionDep, subject: SubjectDep) -> list[MediaAssetResponse]:
    return service.list_media(session, subject, trip_id)


@router.post("/travel-update-candidates", response_model=MediaTravelUpdateCandidatesResponse)
def suggest_travel_update_candidates(
    trip_id: str, payload: MediaTravelUpdateCandidatesRequest, session: SessionDep, subject: SubjectDep
) -> MediaTravelUpdateCandidatesResponse:
    """Calculate owner-requested review groups; no candidate is persisted."""
    return service.suggest_travel_update_candidates(session, subject, trip_id, payload)


@router.get("/{media_id}", response_model=MediaAssetResponse)
def get_media(trip_id: str, media_id: str, session: SessionDep, subject: SubjectDep) -> MediaAssetResponse:
    return service.get_media(session, subject, trip_id, media_id)


@router.delete("/{media_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_media(trip_id: str, media_id: str, session: SessionDep, subject: SubjectDep) -> Response:
    service.remove_media(session, subject, trip_id, media_id)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{media_id}/original")
def get_media_original(
    trip_id: str, media_id: str, session: SessionDep, subject: SubjectDep, storage: StorageDep
) -> StreamingResponse:
    asset = service.owned_media_asset(session, subject, trip_id, media_id)
    original = asset.original_object
    data = storage.get(original.object_key)
    return StreamingResponse(
        iter([data]), media_type=original.content_type, headers=private_original_headers(original.content_type)
    )


@router.get("/{media_id}/thumbnail")
def get_media_thumbnail(
    trip_id: str, media_id: str, request: Request, session: SessionDep, subject: SubjectDep, storage: StorageDep
) -> Response:
    asset, data, content_type = service.media_thumbnail(session, storage, subject, trip_id, media_id)
    etag = f'"thumbnail-v1-{asset.original_object.sha256}"'
    session.commit()
    headers = {"Cache-Control": "private, max-age=300", "ETag": etag, "Vary": "Cookie, Authorization"}
    validators = [value.strip().removeprefix("W/") for value in request.headers.get("if-none-match", "").split(",")]
    if etag in validators or "*" in validators:
        return Response(status_code=304, headers=headers)
    return Response(data, media_type=content_type, headers=headers)


# --- Share/preview derivatives: generated only for owner-selected media -----------


@router.post("/{media_id}/derivatives", response_model=MediaDerivativeResponse, status_code=status.HTTP_201_CREATED)
def add_derivative(
    trip_id: str,
    media_id: str,
    payload: MediaDerivativeCreate,
    session: SessionDep,
    subject: SubjectDep,
    storage: StorageDep,
) -> MediaDerivativeResponse:
    result = service.add_derivative(session, storage, subject, trip_id, media_id, payload)
    session.commit()
    return result


@router.post("/{media_id}/derivatives/{derivative_id}/retry", response_model=MediaDerivativeResponse)
def retry_derivative(
    trip_id: str,
    media_id: str,
    derivative_id: str,
    session: SessionDep,
    subject: SubjectDep,
) -> MediaDerivativeResponse:
    result = service.retry_derivative(session, subject, trip_id, media_id, derivative_id)
    session.commit()
    return result


@router.get("/{media_id}/derivatives", response_model=list[MediaDerivativeResponse])
def list_derivatives(
    trip_id: str, media_id: str, session: SessionDep, subject: SubjectDep
) -> list[MediaDerivativeResponse]:
    result = service.list_derivatives(session, subject, trip_id, media_id)
    session.commit()
    return result


@router.get("/{media_id}/derivatives/{derivative_id}", response_model=MediaDerivativeResponse)
def get_derivative(
    trip_id: str, media_id: str, derivative_id: str, session: SessionDep, subject: SubjectDep
) -> MediaDerivativeResponse:
    result = service.get_derivative(session, subject, trip_id, media_id, derivative_id)
    session.commit()
    return result


@router.post("/{media_id}/derivatives/{derivative_id}/approve", response_model=MediaDerivativeResponse)
def approve_derivative(
    trip_id: str, media_id: str, derivative_id: str, session: SessionDep, subject: SubjectDep
) -> MediaDerivativeResponse:
    result = service.approve_derivative(session, subject, trip_id, media_id, derivative_id)
    session.commit()
    return result


@router.patch("/{media_id}/derivatives/{derivative_id}/presentation", response_model=MediaDerivativeResponse)
def update_derivative_presentation(
    trip_id: str,
    media_id: str,
    derivative_id: str,
    payload: MediaDerivativePresentationUpdate,
    session: SessionDep,
    subject: SubjectDep,
) -> MediaDerivativeResponse:
    result = service.update_derivative_presentation(session, subject, trip_id, media_id, derivative_id, payload)
    session.commit()
    return result


@router.delete("/{media_id}/derivatives/{derivative_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_derivative(
    trip_id: str, media_id: str, derivative_id: str, session: SessionDep, subject: SubjectDep, storage: StorageDep
) -> Response:
    purge = service.remove_derivative(session, subject, trip_id, media_id, derivative_id)
    session.commit()
    purge.finalise(session, storage)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{media_id}/derivatives/{derivative_id}/file")
def get_derivative_file(
    trip_id: str,
    media_id: str,
    derivative_id: str,
    session: SessionDep,
    subject: SubjectDep,
    storage: StorageDep,
    request: Request,
) -> Response:
    stored = service.derivative_file_object(session, subject, trip_id, media_id, derivative_id)
    return media_response(storage, stored, request, {"Cache-Control": "no-store"})


@router.get("/{media_id}/derivatives/{derivative_id}/poster")
def get_derivative_poster(
    trip_id: str,
    media_id: str,
    derivative_id: str,
    session: SessionDep,
    subject: SubjectDep,
    storage: StorageDep,
    request: Request,
) -> Response:
    stored = service.derivative_file_object(session, subject, trip_id, media_id, derivative_id, poster=True)
    return media_response(storage, stored, request, {"Cache-Control": "no-store"})


# --- Provider-mediated imports: owner-explicit selection only ---------------------


@router.post("/imports/{provider}/sessions", response_model=ImportSessionResponse)
def start_import_session(
    trip_id: str,
    provider: ImportProvider,
    session: SessionDep,
    subject: SubjectDep,
    secret_store: SecretStoreDep,
    resolver: ProviderResolverDep,
) -> ImportSessionResponse:
    result = service.start_import_session(session, subject, trip_id, provider, secret_store, resolver)
    session.commit()
    return result


@router.post("/imports/{provider}/sessions/{session_id}/complete", response_model=ImportSessionCompleteResponse)
def complete_import(
    trip_id: str,
    provider: ImportProvider,
    session_id: str,
    session: SessionDep,
    subject: SubjectDep,
    storage: StorageDep,
    secret_store: SecretStoreDep,
    resolver: ProviderResolverDep,
) -> ImportSessionCompleteResponse:
    return service.complete_import(
        session,
        storage,
        subject,
        trip_id,
        provider,
        session_id,
        secret_store,
        resolver,
        checkpoint=session.commit,
    )


# --- Owner provider-token management: never stored in the database ----------------


@provider_tokens_router.get("", response_model=list[ProviderConnectionStatus])
def list_provider_connection_status(
    subject: SubjectDep, secret_store: SecretStoreDep
) -> list[ProviderConnectionStatus]:
    """Expose connection state without ever returning an access token."""
    return service.list_provider_connection_status(subject, secret_store)


@provider_tokens_router.delete("/{provider}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_provider_token(provider: ImportProvider, subject: SubjectDep, secret_store: SecretStoreDep) -> Response:
    try:
        oauth.revoke(subject, provider.value, secret_store)
    except ProviderUnavailableError as error:
        raise service_exception(502, error) from error
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class OAuthComplete(InputModel):
    code: str
    state: str


@provider_tokens_router.post("/google_photos_picker/oauth/start", response_model=OAuthStartResponse)
def start_google_oauth(subject: SubjectDep, secret_store: SecretStoreDep) -> dict[str, str]:
    if not provider_available(ImportProvider.GOOGLE_PHOTOS_PICKER):
        raise ApiException(
            status_code=409,
            detail="Google Photos connection is not configured",
            code="google_photos_connection_is_not_configured",
        )
    return {"authorization_url": oauth.begin(subject, secret_store)}


@provider_tokens_router.post("/google_photos_picker/oauth/complete", status_code=204)
def complete_google_oauth(payload: OAuthComplete, subject: SubjectDep, secret_store: SecretStoreDep) -> Response:
    if not provider_available(ImportProvider.GOOGLE_PHOTOS_PICKER):
        raise ApiException(
            status_code=409,
            detail="Google Photos connection is not configured",
            code="google_photos_connection_is_not_configured",
        )
    try:
        oauth.complete(subject, secret_store, payload.code, payload.state)
    except ProviderUnavailableError as error:
        raise service_exception(409, error) from error
    return Response(status_code=204)
