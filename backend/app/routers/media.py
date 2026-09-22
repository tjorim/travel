from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import current_subject
from ..database import get_session
from ..media.candidates import GPS_AGREEMENT_METRES, GROUPING_WINDOW, build_visit_candidates
from ..media.providers import ProviderError, ProviderUnavailableError, get_provider_resolver
from ..media.service import (
    CreatedImportSession,
    ImportOutcome,
    ImportSessionExpiredError,
    MediaImportError,
    ProviderResolver,
    complete_import_session,
    create_derivative,
    create_import_session,
    delete_media_asset,
    delete_media_derivative,
    direct_upload,
)
from ..models import (
    DerivativeReviewState,
    ImportProvider,
    ImportSession,
    MediaAsset,
    MediaDerivative,
    PublicSurface,
    ShareLink,
)
from ..schemas import (
    ImportSessionCompleteResponse,
    ImportSessionResponse,
    MediaAssetResponse,
    MediaDerivativeCreate,
    MediaDerivativeResponse,
    MediaGpsCoordinates,
    MediaVisitCandidateResponse,
    MediaVisitCandidatesRequest,
    MediaVisitCandidatesResponse,
    MediaVisitLocationOption,
    MediaVisitTimeOption,
    ProviderConnectionStatus,
    ProviderTokenSet,
)
from ..secrets import SecretStore, get_secret_store
from ..storage import ObjectStorage, get_storage
from .trips import owned_trip

router = APIRouter(prefix="/trips/{trip_id}/media", tags=["media"])
provider_tokens_router = APIRouter(prefix="/provider-tokens", tags=["media"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]
StorageDep = Annotated[ObjectStorage, Depends(get_storage)]
SecretStoreDep = Annotated[SecretStore, Depends(get_secret_store)]
ProviderResolverDep = Annotated[ProviderResolver, Depends(get_provider_resolver)]

IMPORT_PROVIDERS = (ImportProvider.GOOGLE_PHOTOS_PICKER, ImportProvider.GOPRO_CLOUD)


def _asset_response(asset: MediaAsset, trip_id: str) -> MediaAssetResponse:
    original = asset.original_object
    exif = asset.raw_metadata.get("exif") or {}
    gps = exif.get("gps")
    return MediaAssetResponse(
        id=asset.id,
        media_kind=asset.media_kind,
        byte_size=original.byte_size,
        content_type=original.content_type,
        captured_at=asset.captured_at,
        created_at=asset.created_at,
        deleted_at=asset.deleted_at,
        original_filename=asset.raw_metadata.get("original_filename"),
        camera_make=exif.get("camera_make"),
        camera_model=exif.get("camera_model"),
        gps=MediaGpsCoordinates(**gps) if gps else None,
        file_url=f"/api/trips/{trip_id}/media/{asset.id}/original",
    )


def _derivative_response(derivative: MediaDerivative, trip_id: str) -> MediaDerivativeResponse:
    return MediaDerivativeResponse(
        id=derivative.id,
        media_asset_id=derivative.media_asset_id,
        purpose=derivative.purpose,
        review_state=derivative.review_state,
        metadata_stripped_at=derivative.metadata_stripped_at,
        width=derivative.width,
        height=derivative.height,
        created_at=derivative.created_at,
        file_url=f"/api/trips/{trip_id}/media/{derivative.media_asset_id}/derivatives/{derivative.id}/file",
    )


def owned_media_asset(session: Session, trip_id: str, subject: str, media_id: str) -> MediaAsset:
    owned_trip(session, trip_id, subject)
    asset = session.scalar(
        select(MediaAsset).where(MediaAsset.id == media_id, MediaAsset.trip_id == trip_id, MediaAsset.deleted_at.is_(None))
    )
    if asset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media not found")
    return asset


def owned_derivative(session: Session, trip_id: str, subject: str, media_id: str, derivative_id: str) -> MediaDerivative:
    asset = owned_media_asset(session, trip_id, subject, media_id)
    derivative = session.scalar(
        select(MediaDerivative).where(MediaDerivative.id == derivative_id, MediaDerivative.media_asset_id == asset.id)
    )
    if derivative is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Derivative not found")
    return derivative


def owned_import_session(session: Session, trip_id: str, subject: str, session_id: str) -> ImportSession:
    owned_trip(session, trip_id, subject)
    row = session.scalar(select(ImportSession).where(ImportSession.id == session_id, ImportSession.trip_id == trip_id))
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Import session not found")
    return row


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
    owned_trip(session, trip_id, subject)
    data = file.file.read()
    if not file.content_type:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="A content type is required")
    try:
        asset, created = direct_upload(
            session, storage, trip_id=trip_id, filename=file.filename or "upload", content_type=file.content_type, data=data
        )
    except MediaImportError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from error
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return _asset_response(asset, trip_id)


@router.get("", response_model=list[MediaAssetResponse])
def list_media(trip_id: str, session: SessionDep, subject: SubjectDep) -> list[MediaAssetResponse]:
    owned_trip(session, trip_id, subject)
    assets = session.scalars(
        select(MediaAsset)
        .where(MediaAsset.trip_id == trip_id, MediaAsset.deleted_at.is_(None))
        .order_by(MediaAsset.created_at.desc())
    )
    return [_asset_response(asset, trip_id) for asset in assets]


@router.post("/visit-candidates", response_model=MediaVisitCandidatesResponse)
def suggest_visit_candidates(
    trip_id: str, payload: MediaVisitCandidatesRequest, session: SessionDep, subject: SubjectDep
) -> MediaVisitCandidatesResponse:
    """Calculate owner-requested review groups; no candidate is persisted."""
    owned_trip(session, trip_id, subject)
    assets = list(
        session.scalars(
            select(MediaAsset).where(
                MediaAsset.trip_id == trip_id,
                MediaAsset.id.in_(payload.media_asset_ids),
                MediaAsset.deleted_at.is_(None),
            )
        )
    )
    found_ids = {asset.id for asset in assets}
    if found_ids != set(payload.media_asset_ids):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Selected media must belong to this trip")
    candidates, unavailable = build_visit_candidates(assets)
    return MediaVisitCandidatesResponse(
        grouping_window_minutes=int(GROUPING_WINDOW.total_seconds() // 60),
        gps_agreement_metres=GPS_AGREEMENT_METRES,
        candidates=[
            MediaVisitCandidateResponse(
                id=candidate.id,
                media_asset_ids=candidate.media_asset_ids,
                starts_at=candidate.starts_at,
                ends_at=candidate.ends_at,
                time_options=[MediaVisitTimeOption(media_asset_id=asset_id, captured_at=captured_at) for asset_id, captured_at in candidate.time_options],
                location_options=[
                    MediaVisitLocationOption(
                        latitude=location.latitude, longitude=location.longitude, media_asset_ids=location.media_asset_ids
                    )
                    for location in candidate.location_options
                ],
            )
            for candidate in candidates
        ],
        unavailable_media_asset_ids=unavailable,
    )


@router.get("/{media_id}", response_model=MediaAssetResponse)
def get_media(trip_id: str, media_id: str, session: SessionDep, subject: SubjectDep) -> MediaAssetResponse:
    return _asset_response(owned_media_asset(session, trip_id, subject, media_id), trip_id)


@router.delete("/{media_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_media(trip_id: str, media_id: str, session: SessionDep, subject: SubjectDep) -> Response:
    asset = owned_media_asset(session, trip_id, subject, media_id)
    delete_media_asset(session, media_asset=asset)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{media_id}/original")
def get_media_original(trip_id: str, media_id: str, session: SessionDep, subject: SubjectDep, storage: StorageDep) -> StreamingResponse:
    asset = owned_media_asset(session, trip_id, subject, media_id)
    original = asset.original_object
    data = storage.get(original.object_key)
    return StreamingResponse(
        iter([data]), media_type=original.content_type, headers={"Cache-Control": "no-store"}
    )


# --- Share/preview derivatives: generated only for owner-selected media -----------


@router.post("/{media_id}/derivatives", response_model=MediaDerivativeResponse, status_code=status.HTTP_201_CREATED)
def add_derivative(
    trip_id: str, media_id: str, payload: MediaDerivativeCreate, session: SessionDep, subject: SubjectDep, storage: StorageDep
) -> MediaDerivativeResponse:
    asset = owned_media_asset(session, trip_id, subject, media_id)
    try:
        derivative = create_derivative(
            session, storage, media_asset=asset, purpose=payload.purpose, max_dimension=payload.max_dimension
        )
    except MediaImportError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from error
    return _derivative_response(derivative, trip_id)


@router.get("/{media_id}/derivatives", response_model=list[MediaDerivativeResponse])
def list_derivatives(trip_id: str, media_id: str, session: SessionDep, subject: SubjectDep) -> list[MediaDerivativeResponse]:
    asset = owned_media_asset(session, trip_id, subject, media_id)
    return [_derivative_response(derivative, trip_id) for derivative in asset.derivatives]


@router.post("/{media_id}/derivatives/{derivative_id}/approve", response_model=MediaDerivativeResponse)
def approve_derivative(
    trip_id: str, media_id: str, derivative_id: str, session: SessionDep, subject: SubjectDep
) -> MediaDerivativeResponse:
    derivative = owned_derivative(session, trip_id, subject, media_id, derivative_id)
    derivative.review_state = DerivativeReviewState.APPROVED
    session.commit()
    return _derivative_response(derivative, trip_id)


def _remove_from_live_scopes(session: Session, *, trip_id: str, derivative_id: str) -> None:
    """Withdraw a deleted derivative from public and unlisted live scopes."""
    holders = [session.get(PublicSurface, trip_id), *session.scalars(select(ShareLink).where(ShareLink.trip_id == trip_id))]
    for holder in holders:
        if holder is None:
            continue
        scope = dict(holder.scope)
        items = scope.get("items", [])
        filtered = [item for item in items if not (item.get("kind") == "media_derivative" and item.get("id") == derivative_id)]
        if len(filtered) != len(items):
            holder.scope = {**scope, "items": filtered}


@router.delete("/{media_id}/derivatives/{derivative_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_derivative(
    trip_id: str, media_id: str, derivative_id: str, session: SessionDep, subject: SubjectDep, storage: StorageDep
) -> Response:
    derivative = owned_derivative(session, trip_id, subject, media_id, derivative_id)
    _remove_from_live_scopes(session, trip_id=trip_id, derivative_id=derivative.id)
    delete_media_derivative(session, storage, derivative=derivative)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{media_id}/derivatives/{derivative_id}/file")
def get_derivative_file(
    trip_id: str, media_id: str, derivative_id: str, session: SessionDep, subject: SubjectDep, storage: StorageDep
) -> StreamingResponse:
    derivative = owned_derivative(session, trip_id, subject, media_id, derivative_id)
    data = storage.get(derivative.object.object_key)
    return StreamingResponse(iter([data]), media_type=derivative.object.content_type, headers={"Cache-Control": "no-store"})


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
    owned_trip(session, trip_id, subject)
    if provider not in IMPORT_PROVIDERS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Not an importable provider")
    try:
        created: CreatedImportSession = create_import_session(
            session, secret_store, resolver, trip_id=trip_id, subject=subject, provider=provider
        )
    except ProviderUnavailableError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    except ProviderError as error:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(error)) from error
    return ImportSessionResponse(
        id=created.session.id,
        provider=created.session.provider,
        state=created.session.state,
        picker_uri=created.picker_uri,
        expires_at=created.session.expires_at,
    )


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
    import_session = owned_import_session(session, trip_id, subject, session_id)
    if import_session.provider != provider:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Import session not found")
    try:
        outcome: ImportOutcome = complete_import_session(
            session, storage, secret_store, resolver, trip_id=trip_id, subject=subject, import_session=import_session
        )
    except (ProviderUnavailableError, ImportSessionExpiredError) as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    except (ProviderError, MediaImportError) as error:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(error)) from error
    return ImportSessionCompleteResponse(
        ready=outcome.ready,
        imported=[_asset_response(asset, trip_id) for asset in outcome.imported],
        failed=[{"provider_item_id": item_id, "failure_code": code} for item_id, code in outcome.failed],
    )


# --- Owner provider-token management: never stored in the database ----------------


@provider_tokens_router.get("", response_model=list[ProviderConnectionStatus])
def list_provider_connection_status(subject: SubjectDep, secret_store: SecretStoreDep) -> list[ProviderConnectionStatus]:
    """Expose connection state without ever returning an access token."""
    return [
        ProviderConnectionStatus(provider=provider, connected=secret_store.get_token(subject=subject, provider=provider.value) is not None)
        for provider in IMPORT_PROVIDERS
    ]


@provider_tokens_router.put("/{provider}", status_code=status.HTTP_204_NO_CONTENT)
def set_provider_token(
    provider: ImportProvider, payload: ProviderTokenSet, subject: SubjectDep, secret_store: SecretStoreDep
) -> Response:
    secret_store.set_token(subject=subject, provider=provider.value, token=payload.access_token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@provider_tokens_router.delete("/{provider}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_provider_token(provider: ImportProvider, subject: SubjectDep, secret_store: SecretStoreDep) -> Response:
    secret_store.revoke_token(subject=subject, provider=provider.value)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
