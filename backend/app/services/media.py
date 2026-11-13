"""Trip media: uploads, derivatives for audiences, and provider imports.

Shared by the HTTP routers and the MCP tools. Like every service this never commits; the object-storage lifecycle
(``docs/object-storage.md``) is kept by splitting it around the caller's commit:

* An upload or a derivative writes and verifies its bytes, then flushes the row. The caller commits after, so the
  bytes exist before the row does (rule 1).
* Removing a derivative marks its objects ``purge_pending`` and returns a ``PendingPurge``. The caller commits and
  then finalises it, so bytes are deleted only for a row already committed as ``purge_pending`` (rule 3).
* Completing a provider import fetches each item from the provider, which can take long, so the import makes each
  finished item durable through the caller's ``checkpoint`` (its commit) instead of one commit at the end.
"""

from collections.abc import Callable
from datetime import UTC, datetime
from typing import BinaryIO

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..errors import BadGateway, Conflict, RecordNotFound, Refusal, service_error
from ..media.candidates import GPS_AGREEMENT_METRES, GROUPING_WINDOW, build_travel_update_candidates
from ..media.providers import ProviderError, ProviderUnavailableError, provider_available
from ..media.service import (
    CreatedImportSession,
    ImportOutcome,
    ImportSessionExpiredError,
    MediaImportError,
    PendingPurge,
    ProviderResolver,
    cached_thumbnail,
    complete_import_session,
    create_derivative,
    create_import_session,
    delete_media_asset,
    delete_media_derivative,
    direct_upload,
    expire_stalled_video_derivatives,
    queue_video_derivative,
    read_bounded_upload,
)
from ..models import (
    DerivativeProcessingBackend,
    DerivativeProcessingState,
    DerivativeReviewState,
    ImportProvider,
    ImportSession,
    MediaAsset,
    MediaDerivative,
    MediaKind,
    StoredObject,
    TravelUpdate,
)
from ..schemas import (
    ImportSessionCompleteResponse,
    ImportSessionResponse,
    MediaAssetResponse,
    MediaDerivativeCreate,
    MediaDerivativePresentationUpdate,
    MediaDerivativeResponse,
    MediaGpsCoordinates,
    MediaTravelUpdateCandidateResponse,
    MediaTravelUpdateCandidatesRequest,
    MediaTravelUpdateCandidatesResponse,
    MediaTravelUpdateLocationOption,
    MediaTravelUpdateTimeOption,
    ProviderConnectionStatus,
)
from ..secrets import SecretStore
from ..storage import ObjectStorage
from .trips import owned_trip

IMPORT_PROVIDERS = (ImportProvider.GOOGLE_PHOTOS_PICKER, ImportProvider.GOPRO_CLOUD)


def _as[Kind: Refusal](kind: type[Kind], error: ValueError) -> Kind:
    """A lower layer's failure as the refusal of a given status, keeping its message and code."""
    refusal = service_error(error)
    return kind(str(refusal), code=refusal.code, params=refusal.params)


def asset_response(asset: MediaAsset, trip_id: str) -> MediaAssetResponse:
    original = asset.original_object
    exif = asset.raw_metadata.get("exif") or {}
    gps = exif.get("gps")
    return MediaAssetResponse(
        id=asset.id,
        media_kind=asset.media_kind,
        byte_size=original.byte_size,
        content_type=original.content_type,
        captured_at=asset.captured_at,
        captured_local=asset.captured_local,
        created_at=asset.created_at,
        deleted_at=asset.deleted_at,
        original_filename=asset.raw_metadata.get("original_filename"),
        camera_make=exif.get("camera_make"),
        camera_model=exif.get("camera_model"),
        gps=MediaGpsCoordinates(**gps) if gps else None,
        file_url=f"/api/trips/{trip_id}/media/{asset.id}/original",
        thumbnail_url=(
            f"/api/trips/{trip_id}/media/{asset.id}/thumbnail" if asset.media_kind == MediaKind.PHOTO else None
        ),
    )


def derivative_response(derivative: MediaDerivative, trip_id: str) -> MediaDerivativeResponse:
    return MediaDerivativeResponse(
        id=derivative.id,
        media_asset_id=derivative.media_asset_id,
        purpose=derivative.purpose,
        review_state=derivative.review_state,
        processing_state=derivative.processing_state.value,
        media_kind=derivative.media_asset.media_kind,
        content_type=derivative.object.content_type if derivative.object else None,
        byte_size=derivative.object.byte_size if derivative.object else None,
        duration_seconds=derivative.duration_seconds,
        poster_url=(
            f"/api/trips/{trip_id}/media/{derivative.media_asset_id}/derivatives/{derivative.id}/poster"
            if derivative.poster_object_id
            else None
        ),
        remove_audio=derivative.remove_audio,
        metadata_stripped_at=derivative.metadata_stripped_at,
        width=derivative.width,
        height=derivative.height,
        travel_update_id=derivative.travel_update_id,
        caption=derivative.caption,
        alt_text=derivative.alt_text,
        focal_x=derivative.focal_x,
        focal_y=derivative.focal_y,
        visibility=derivative.visibility,
        is_cover=derivative.is_cover,
        created_at=derivative.created_at,
        file_url=f"/api/trips/{trip_id}/media/{derivative.media_asset_id}/derivatives/{derivative.id}/file",
    )


def owned_media_asset(session: Session, subject: str, trip_id: str, media_id: str) -> MediaAsset:
    owned_trip(session, trip_id, subject)
    asset = session.scalar(
        select(MediaAsset).where(
            MediaAsset.id == media_id, MediaAsset.trip_id == trip_id, MediaAsset.deleted_at.is_(None)
        )
    )
    if asset is None:
        raise RecordNotFound("Media not found")
    return asset


def owned_derivative(
    session: Session, subject: str, trip_id: str, media_id: str, derivative_id: str
) -> MediaDerivative:
    asset = owned_media_asset(session, subject, trip_id, media_id)
    derivative = session.scalar(
        select(MediaDerivative).where(MediaDerivative.id == derivative_id, MediaDerivative.media_asset_id == asset.id)
    )
    if derivative is None:
        raise RecordNotFound("Derivative not found")
    return derivative


def owned_import_session(session: Session, subject: str, trip_id: str, session_id: str) -> ImportSession:
    owned_trip(session, trip_id, subject)
    row = session.scalar(select(ImportSession).where(ImportSession.id == session_id, ImportSession.trip_id == trip_id))
    if row is None:
        raise RecordNotFound("Import session not found")
    return row


# --- Direct device upload: the durable fallback, always available -----------------


def upload_media(
    session: Session,
    storage: ObjectStorage,
    subject: str,
    trip_id: str,
    *,
    filename: str | None,
    content_type: str | None,
    file: BinaryIO,
) -> tuple[MediaAssetResponse, bool]:
    """Store a media original; the caller commits after. The flag says whether it is new (the same bytes are
    stored once)."""
    owned_trip(session, trip_id, subject)
    if not content_type:
        raise Refusal("A content type is required", code="a_content_type_is_required")
    try:
        with read_bounded_upload(file) as data:
            asset, created = direct_upload(
                session, storage, trip_id=trip_id, filename=filename or "upload", content_type=content_type, data=data
            )
    except MediaImportError as error:
        raise service_error(error) from error
    return asset_response(asset, trip_id), created


def list_media(session: Session, subject: str, trip_id: str) -> list[MediaAssetResponse]:
    owned_trip(session, trip_id, subject)
    assets = session.scalars(
        select(MediaAsset)
        .where(MediaAsset.trip_id == trip_id, MediaAsset.deleted_at.is_(None))
        .order_by(MediaAsset.created_at.desc())
    )
    return [asset_response(asset, trip_id) for asset in assets]


def suggest_travel_update_candidates(
    session: Session, subject: str, trip_id: str, payload: MediaTravelUpdateCandidatesRequest
) -> MediaTravelUpdateCandidatesResponse:
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
        raise Refusal("Selected media must belong to this trip", code="selected_media_must_belong_to_this_trip")
    candidates, unavailable = build_travel_update_candidates(assets)
    return MediaTravelUpdateCandidatesResponse(
        grouping_window_minutes=int(GROUPING_WINDOW.total_seconds() // 60),
        gps_agreement_metres=GPS_AGREEMENT_METRES,
        candidates=[
            MediaTravelUpdateCandidateResponse(
                id=candidate.id,
                media_asset_ids=candidate.media_asset_ids,
                starts_at=candidate.starts_at,
                ends_at=candidate.ends_at,
                captured_local=candidate.captured_local,
                time_options=[
                    MediaTravelUpdateTimeOption(
                        media_asset_id=asset_id, captured_at=captured_at, captured_local=captured_local
                    )
                    for asset_id, captured_at, captured_local in candidate.time_options
                ],
                location_options=[
                    MediaTravelUpdateLocationOption(
                        latitude=location.latitude,
                        longitude=location.longitude,
                        media_asset_ids=location.media_asset_ids,
                    )
                    for location in candidate.location_options
                ],
            )
            for candidate in candidates
        ],
        unavailable_media_asset_ids=unavailable,
    )


def get_media(session: Session, subject: str, trip_id: str, media_id: str) -> MediaAssetResponse:
    return asset_response(owned_media_asset(session, subject, trip_id, media_id), trip_id)


def remove_media(session: Session, subject: str, trip_id: str, media_id: str) -> None:
    """Soft-delete: gone from owner queries at once; the bytes are purged later, after the recoverable window."""
    delete_media_asset(session, media_asset=owned_media_asset(session, subject, trip_id, media_id))


def media_thumbnail(
    session: Session, storage: ObjectStorage, subject: str, trip_id: str, media_id: str
) -> tuple[MediaAsset, bytes, str]:
    """The private preview of a photo, created on first use; the caller commits a newly created one."""
    asset = owned_media_asset(session, subject, trip_id, media_id)
    try:
        data, content_type = cached_thumbnail(session, storage, media_asset=asset)
    except MediaImportError as error:
        raise _as(RecordNotFound, error) from error
    return asset, data, content_type


# --- Share/preview derivatives: generated only for owner-selected media -----------


def add_derivative(
    session: Session,
    storage: ObjectStorage,
    subject: str,
    trip_id: str,
    media_id: str,
    payload: MediaDerivativeCreate,
) -> MediaDerivativeResponse:
    asset = owned_media_asset(session, subject, trip_id, media_id)
    try:
        if asset.media_kind == MediaKind.VIDEO:
            derivative = queue_video_derivative(
                session, media_asset=asset, purpose=payload.purpose, remove_audio=payload.remove_audio
            )
        else:
            derivative = create_derivative(
                session, storage, media_asset=asset, purpose=payload.purpose, max_dimension=payload.max_dimension
            )
    except MediaImportError as error:
        raise service_error(error) from error
    return derivative_response(derivative, trip_id)


def retry_derivative(
    session: Session, subject: str, trip_id: str, media_id: str, derivative_id: str
) -> MediaDerivativeResponse:
    derivative = owned_derivative(session, subject, trip_id, media_id, derivative_id)
    if (
        derivative.media_asset.media_kind != MediaKind.VIDEO
        or derivative.processing_state != DerivativeProcessingState.FAILED
    ):
        raise Conflict("Only failed videos can be retried", code="only_failed_videos_can_be_retried")
    from ..media.worker import enqueue, retire

    retire(session, derivative.id)
    derivative.processing_backend = DerivativeProcessingBackend.REMOTE
    derivative.processing_state = DerivativeProcessingState.PROCESSING
    enqueue(session, derivative)
    derivative.processing_started_at = datetime.now(UTC)
    session.flush()
    return derivative_response(derivative, trip_id)


def list_derivatives(session: Session, subject: str, trip_id: str, media_id: str) -> list[MediaDerivativeResponse]:
    asset = owned_media_asset(session, subject, trip_id, media_id)
    expire_stalled_video_derivatives(session, asset.derivatives)
    return [
        derivative_response(derivative, trip_id)
        for derivative in asset.derivatives
        if derivative.processing_backend != DerivativeProcessingBackend.THUMBNAIL
    ]


def get_derivative(
    session: Session, subject: str, trip_id: str, media_id: str, derivative_id: str
) -> MediaDerivativeResponse:
    derivative = owned_derivative(session, subject, trip_id, media_id, derivative_id)
    expire_stalled_video_derivatives(session, [derivative])
    return derivative_response(derivative, trip_id)


def approve_derivative(
    session: Session, subject: str, trip_id: str, media_id: str, derivative_id: str
) -> MediaDerivativeResponse:
    derivative = owned_derivative(session, subject, trip_id, media_id, derivative_id)
    if derivative.processing_state != DerivativeProcessingState.READY or derivative.object_id is None:
        raise Conflict("Derivative is not ready for review", code="derivative_is_not_ready_for_review")
    derivative.review_state = DerivativeReviewState.APPROVED
    session.flush()
    return derivative_response(derivative, trip_id)


def update_derivative_presentation(
    session: Session,
    subject: str,
    trip_id: str,
    media_id: str,
    derivative_id: str,
    payload: MediaDerivativePresentationUpdate,
) -> MediaDerivativeResponse:
    derivative = owned_derivative(session, subject, trip_id, media_id, derivative_id)
    values = payload.model_dump(exclude_unset=True)
    if values.get("travel_update_id") is not None:
        update = session.get(TravelUpdate, values["travel_update_id"])
        if update is None or update.trip_id != trip_id:
            raise Refusal(
                "Travel update is unavailable for this trip", code="travel_update_is_unavailable_for_this_trip"
            )
    for field, value in values.items():
        setattr(derivative, field, value)
    session.flush()
    return derivative_response(derivative, trip_id)


def remove_derivative(session: Session, subject: str, trip_id: str, media_id: str, derivative_id: str) -> PendingPurge:
    """Remove a derivative; the caller commits, then finalises the returned purge with its storage."""
    derivative = owned_derivative(session, subject, trip_id, media_id, derivative_id)
    return delete_media_derivative(session, derivative=derivative)


def derivative_file_object(
    session: Session, subject: str, trip_id: str, media_id: str, derivative_id: str, *, poster: bool = False
) -> StoredObject:
    """The stored object of a derivative (or its poster) for the owner to read, or a not-found refusal."""
    derivative = owned_derivative(session, subject, trip_id, media_id, derivative_id)
    stored = derivative.poster_object if poster else derivative.object
    if stored is None:
        if poster:
            raise RecordNotFound("Poster is not ready", code="poster_is_not_ready")
        raise RecordNotFound("Derivative is not ready", code="derivative_is_not_ready")
    return stored


# --- Provider-mediated imports: owner-explicit selection only ---------------------


def start_import_session(
    session: Session,
    subject: str,
    trip_id: str,
    provider: ImportProvider,
    secret_store: SecretStore,
    resolver: ProviderResolver,
) -> ImportSessionResponse:
    owned_trip(session, trip_id, subject)
    if provider not in IMPORT_PROVIDERS:
        raise Refusal("Not an importable provider", code="not_an_importable_provider")
    if not provider_available(provider):
        raise Conflict("Provider connection is not configured", code="provider_connection_is_not_configured")
    try:
        created: CreatedImportSession = create_import_session(
            session, secret_store, resolver, trip_id=trip_id, subject=subject, provider=provider
        )
    except ProviderUnavailableError as error:
        raise _as(Conflict, error) from error
    except ProviderError as error:
        raise _as(BadGateway, error) from error
    return ImportSessionResponse.model_validate(
        {
            "id": created.session.id,
            "provider": created.session.provider,
            "state": created.session.state,
            "picker_uri": created.picker_uri,
            "expires_at": created.session.expires_at,
        }
    )


def complete_import(
    session: Session,
    storage: ObjectStorage,
    subject: str,
    trip_id: str,
    provider: ImportProvider,
    session_id: str,
    secret_store: SecretStore,
    resolver: ProviderResolver,
    *,
    checkpoint: Callable[[], None],
) -> ImportSessionCompleteResponse:
    """Copy what the owner selected from the provider; ``checkpoint`` (the caller's commit) makes each item durable."""
    import_session = owned_import_session(session, subject, trip_id, session_id)
    if import_session.provider != provider:
        raise RecordNotFound("Import session not found")
    try:
        outcome: ImportOutcome = complete_import_session(
            session,
            storage,
            secret_store,
            resolver,
            trip_id=trip_id,
            subject=subject,
            import_session=import_session,
            checkpoint=checkpoint,
        )
    except (ProviderUnavailableError, ImportSessionExpiredError) as error:
        raise _as(Conflict, error) from error
    except (ProviderError, MediaImportError) as error:
        raise _as(BadGateway, error) from error
    return ImportSessionCompleteResponse(
        ready=outcome.ready,
        imported=[asset_response(asset, trip_id) for asset in outcome.imported],
        failed=[{"provider_item_id": item_id, "failure_code": code} for item_id, code in outcome.failed],
    )


def list_provider_connection_status(subject: str, secret_store: SecretStore) -> list[ProviderConnectionStatus]:
    """Expose connection state without ever returning an access token."""
    return [
        ProviderConnectionStatus(
            provider=provider,
            available=provider_available(provider),
            connected=secret_store.get_credential(subject=subject, provider=provider.value) is not None,
        )
        for provider in IMPORT_PROVIDERS
    ]
