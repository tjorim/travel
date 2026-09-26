"""Media ingestion service: the copy-verify-record pipeline shared by direct
upload and every provider import, plus stripped/resized derivative creation
and deletion/purge.

Every path here ends the same way regardless of source: bytes are hashed,
written to Travel-controlled object storage, verified by re-reading them
back, and only then does a database row make them a canonical `MediaAsset`.
A provider URL or a device's local file handle is never stored as the
servable reference. Dedup and idempotent retry both key off
`(trip_id, sha256)` for storage and `(trip_id, provider, provider_item_id)`
for import provenance, so re-running an interrupted import is always safe.
"""

import io
import json
import subprocess
import sys
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

from PIL import Image, ImageOps
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from ..config import settings
from ..models import (
    DerivativeProcessingState,
    DerivativePurpose,
    DerivativeReviewState,
    DocumentAsset,
    ImportProvider,
    ImportRecord,
    ImportSession,
    ImportSessionState,
    ImportState,
    MediaAsset,
    MediaDerivative,
    MediaKind,
    ObjectState,
    StoredObject,
    opaque_id,
)
from ..secrets import SecretStore
from ..storage import ObjectStorage, sha256_hex
from .oauth import access_token
from .providers import MediaProvider, ProviderError

ProviderResolver = Callable[[ImportProvider], MediaProvider]


class MediaImportError(RuntimeError):
    """A local (non-provider) ingestion failure: oversized upload, an
    unsupported content type, or a storage checksum mismatch."""


class ImportSessionExpiredError(MediaImportError):
    """The picker session's expiry passed before the owner completed it."""


def _aware_utc(value: datetime) -> datetime:
    # SQLite (used in tests) drops tzinfo on round-trip even for a
    # DateTime(timezone=True) column; Postgres (production) preserves it.
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _media_kind_for(content_type: str) -> MediaKind:
    if content_type.startswith("image/"):
        return MediaKind.PHOTO
    if content_type.startswith("video/"):
        return MediaKind.VIDEO
    raise MediaImportError(f"Unsupported media content type: {content_type}")


_EXIF_MAKE = 271
_EXIF_MODEL = 272
_EXIF_DATETIME_ORIGINAL = 36867
_EXIF_OFFSET_TIME_ORIGINAL = 36881
_EXIF_GPS_IFD = 0x8825


def _dms_to_decimal(dms: tuple | None, ref: str | None) -> float | None:
    if not dms or ref not in ("N", "S", "E", "W"):
        return None
    try:
        degrees, minutes, seconds = (float(part) for part in dms)
    except (TypeError, ValueError):
        return None
    decimal = degrees + minutes / 60 + seconds / 3600
    return -decimal if ref in ("S", "W") else decimal


def _exif_captured_at(exif) -> datetime | None:
    raw = exif.get(_EXIF_DATETIME_ORIGINAL)
    if not raw:
        return None
    try:
        captured = datetime.strptime(str(raw), "%Y:%m:%d %H:%M:%S")
    except ValueError:
        return None
    offset = exif.get(_EXIF_OFFSET_TIME_ORIGINAL)
    if offset and len(str(offset)) == 6 and str(offset)[0] in "+-":
        sign = 1 if str(offset)[0] == "+" else -1
        try:
            hours, minutes = (int(part) for part in str(offset)[1:].split(":"))
        except ValueError:
            return captured.replace(tzinfo=UTC)
        return captured.replace(tzinfo=timezone(sign * timedelta(hours=hours, minutes=minutes)))
    # EXIF rarely carries a UTC offset; treat a bare timestamp as the best
    # available capture instant rather than dropping it, same as most photo
    # tooling does.
    return captured.replace(tzinfo=UTC)


def extract_exif_metadata(data: bytes) -> dict:
    """Best-effort capture time/camera/GPS extraction from a photo original,
    for the owner's own convenience — e.g. pre-filling a reisupdate's date or
    suggesting a place when they add media to a trip. This is the one place
    EXIF is read, never stripped: the original keeps it embedded untouched,
    and only a share/static-export derivative (`create_derivative`) discards
    it, because that copy — not this one — is the one a public/unlisted
    viewer could ever reach."""
    try:
        with Image.open(io.BytesIO(data)) as image:
            exif = image.getexif()
            if not exif:
                return {}
            metadata: dict = {}
            make = exif.get(_EXIF_MAKE)
            model = exif.get(_EXIF_MODEL)
            if make:
                metadata["camera_make"] = str(make).strip("\x00 ")
            if model:
                metadata["camera_model"] = str(model).strip("\x00 ")
            captured_at = _exif_captured_at(exif)
            if captured_at is not None:
                metadata["captured_at"] = captured_at
            gps_ifd = exif.get_ifd(_EXIF_GPS_IFD)
            if gps_ifd:
                latitude = _dms_to_decimal(gps_ifd.get(2), gps_ifd.get(1))
                longitude = _dms_to_decimal(gps_ifd.get(4), gps_ifd.get(3))
                if latitude is not None and longitude is not None:
                    metadata["gps"] = {"latitude": latitude, "longitude": longitude}
            return metadata
    except Exception:
        # A best-effort convenience read must never block an otherwise-valid
        # upload/import over a corrupt or unusual EXIF block.
        return {}


def _merge_exif(raw_metadata: dict, exif: dict) -> tuple[dict, datetime | None]:
    exif_json = {key: value for key, value in exif.items() if key != "captured_at"}
    if exif_json:
        raw_metadata = {**raw_metadata, "exif": exif_json}
    return raw_metadata, exif.get("captured_at")


def _store_bytes(session: Session, storage: ObjectStorage, *, trip_id: str, data: bytes, content_type: str) -> StoredObject:
    digest = sha256_hex(data)
    # Serialize reuse of a pending object with the purge's final deletion.
    existing = session.scalar(
        select(StoredObject).where(StoredObject.trip_id == trip_id, StoredObject.sha256 == digest).with_for_update()
    )
    if existing is not None and existing.state == ObjectState.AVAILABLE:
        return existing

    key = existing.object_key if existing is not None else f"{trip_id}/{opaque_id()}"
    storage.put(key, data)
    verified = sha256_hex(storage.get(key)) == digest

    if existing is not None:
        existing.byte_size = len(data)
        existing.content_type = content_type
        existing.state = ObjectState.AVAILABLE if verified else ObjectState.QUARANTINED
        obj = existing
    else:
        obj = StoredObject(
            trip_id=trip_id,
            object_key=key,
            sha256=digest,
            byte_size=len(data),
            content_type=content_type,
            state=ObjectState.AVAILABLE if verified else ObjectState.QUARANTINED,
        )
        session.add(obj)
    session.flush()
    if not verified:
        raise MediaImportError("Stored object failed checksum verification after write")
    return obj


def store_uploaded_object(
    session: Session, storage: ObjectStorage, *, trip_id: str, data: bytes, content_type: str
) -> StoredObject:
    """Store one bounded owner-uploaded object through the shared durable
    copy-and-verify path.

    This is intentionally not media-specific: document uploads use the
    same trip-local checksum, opaque key, storage read-back verification and
    ``StoredObject`` inventory as media. Callers attach their own canonical
    resource only after this function returns an available object.
    """
    if not data:
        raise MediaImportError("File must not be empty")
    if len(data) > settings.media_max_upload_bytes:
        raise MediaImportError("File exceeds the maximum upload size")
    return _store_bytes(session, storage, trip_id=trip_id, data=data, content_type=content_type)


def _existing_media_asset_for_object(session: Session, trip_id: str, stored_object_id: str) -> MediaAsset | None:
    return session.scalar(
        select(MediaAsset).where(MediaAsset.trip_id == trip_id, MediaAsset.original_object_id == stored_object_id)
    )


def direct_upload(
    session: Session,
    storage: ObjectStorage,
    *,
    trip_id: str,
    filename: str,
    content_type: str,
    data: bytes,
    captured_at: datetime | None = None,
) -> tuple[MediaAsset, bool]:
    """Copy a directly uploaded file into storage and record it.

    Returns `(asset, created)`; `created` is `False` when identical bytes
    were already imported for this trip (retry-safe, no duplicate record).
    """
    media_kind = _media_kind_for(content_type)

    stored = store_uploaded_object(session, storage, trip_id=trip_id, data=data, content_type=content_type)
    existing_asset = _existing_media_asset_for_object(session, trip_id, stored.id)
    if existing_asset is not None:
        session.commit()
        return existing_asset, False

    record = ImportRecord(
        trip_id=trip_id,
        provider=ImportProvider.DIRECT_DEVICE,
        provider_item_id=stored.sha256,
        state=ImportState.COMPLETED,
        completed_at=datetime.now(UTC),
    )
    session.add(record)
    session.flush()
    exif = extract_exif_metadata(data) if media_kind == MediaKind.PHOTO else {}
    raw_metadata, exif_captured_at = _merge_exif({"original_filename": filename}, exif)
    asset = MediaAsset(
        trip_id=trip_id,
        original_object_id=stored.id,
        media_kind=media_kind,
        captured_at=exif_captured_at or captured_at,
        import_id=record.id,
        raw_metadata=raw_metadata,
    )
    session.add(asset)
    session.flush()
    record.media_asset_id = asset.id
    session.commit()
    return asset, True


@dataclass
class CreatedImportSession:
    session: ImportSession
    picker_uri: str | None


def create_import_session(
    session: Session,
    secret_store: SecretStore,
    resolver: ProviderResolver,
    *,
    trip_id: str,
    subject: str,
    provider: ImportProvider,
) -> CreatedImportSession:
    if provider == ImportProvider.DIRECT_DEVICE:
        raise MediaImportError("Direct device upload does not use an import session")
    token = access_token(subject, provider.value, secret_store)
    media_provider = resolver(provider)
    provider_session = media_provider.create_session(access_token=token)
    row = ImportSession(
        trip_id=trip_id,
        provider=provider,
        provider_session_id=provider_session.provider_session_id,
        expires_at=provider_session.expires_at,
    )
    session.add(row)
    session.commit()
    return CreatedImportSession(session=row, picker_uri=provider_session.picker_uri)


@dataclass
class ImportOutcome:
    ready: bool
    imported: list[MediaAsset]
    failed: list[tuple[str, str]]


def complete_import_session(
    session: Session,
    storage: ObjectStorage,
    secret_store: SecretStore,
    resolver: ProviderResolver,
    *,
    trip_id: str,
    subject: str,
    import_session: ImportSession,
) -> ImportOutcome:
    """Import every item the owner selected in `import_session`.

    Safe to call more than once: an item whose `ImportRecord` already reached
    `completed` is skipped (its existing `MediaAsset` is still returned), and
    one item's failure records `failed`/`failure_code` on its own record
    without blocking the rest — a later retry only reattempts the failures.
    """
    if import_session.state == ImportSessionState.EXPIRED:
        raise ImportSessionExpiredError("This import session has expired")
    if import_session.expires_at is not None and _aware_utc(import_session.expires_at) <= datetime.now(UTC):
        import_session.state = ImportSessionState.EXPIRED
        session.commit()
        raise ImportSessionExpiredError("This import session has expired")
    token = access_token(subject, import_session.provider.value, secret_store)
    media_provider = resolver(import_session.provider)

    status = media_provider.poll_session(access_token=token, provider_session_id=import_session.provider_session_id)
    if not status.ready:
        return ImportOutcome(ready=False, imported=[], failed=[])

    items = media_provider.list_selected_items(access_token=token, provider_session_id=import_session.provider_session_id)
    imported: list[MediaAsset] = []
    failed: list[tuple[str, str]] = []

    for item in items:
        existing_record = session.scalar(
            select(ImportRecord).where(
                ImportRecord.trip_id == trip_id,
                ImportRecord.provider == import_session.provider,
                ImportRecord.provider_item_id == item.provider_item_id,
            )
        )
        if existing_record is not None and existing_record.state == ImportState.COMPLETED:
            asset = session.get(MediaAsset, existing_record.media_asset_id)
            if asset is not None:
                imported.append(asset)
            continue

        try:
            data = media_provider.fetch_item(
                access_token=access_token(subject, import_session.provider.value, secret_store), item=item
            )
            if len(data) > settings.media_max_upload_bytes:
                raise MediaImportError("Imported item exceeds the maximum size")
            stored = _store_bytes(session, storage, trip_id=trip_id, data=data, content_type=item.content_type)
            existing_asset = _existing_media_asset_for_object(session, trip_id, stored.id)
            record = existing_record or ImportRecord(
                trip_id=trip_id,
                provider=import_session.provider,
                provider_item_id=item.provider_item_id,
                state=ImportState.PENDING,
            )
            if existing_record is None:
                session.add(record)
            if existing_asset is not None:
                asset = existing_asset
            else:
                media_kind = _media_kind_for(item.content_type)
                exif = extract_exif_metadata(data) if media_kind == MediaKind.PHOTO else {}
                raw_metadata, exif_captured_at = _merge_exif(
                    {"original_filename": item.filename, "provider_item_id": item.provider_item_id}, exif
                )
                asset = MediaAsset(
                    trip_id=trip_id,
                    original_object_id=stored.id,
                    media_kind=media_kind,
                    captured_at=exif_captured_at or item.captured_at,
                    import_id=None,
                    raw_metadata=raw_metadata,
                )
                session.add(asset)
                session.flush()
            record.state = ImportState.COMPLETED
            record.completed_at = datetime.now(UTC)
            record.media_asset_id = asset.id
            record.failure_code = None
            asset.import_id = record.id if asset.import_id is None else asset.import_id
            session.flush()
            session.commit()
            imported.append(asset)
        except (ProviderError, MediaImportError) as error:
            session.rollback()
            record = session.scalar(
                select(ImportRecord).where(
                    ImportRecord.trip_id == trip_id,
                    ImportRecord.provider == import_session.provider,
                    ImportRecord.provider_item_id == item.provider_item_id,
                )
            )
            failure_code = str(error)[:120]
            if record is None:
                record = ImportRecord(
                    trip_id=trip_id,
                    provider=import_session.provider,
                    provider_item_id=item.provider_item_id,
                    state=ImportState.FAILED,
                    failure_code=failure_code,
                )
                session.add(record)
            else:
                record.state = ImportState.FAILED
                record.failure_code = failure_code
            session.commit()
            failed.append((item.provider_item_id, failure_code))

    import_session.state = ImportSessionState.COMPLETED
    session.commit()
    return ImportOutcome(ready=True, imported=imported, failed=failed)


DERIVATIVE_FORMAT = "WEBP"
DERIVATIVE_CONTENT_TYPE = "image/webp"
VIDEO_CONTENT_TYPE = "video/mp4"
VIDEO_MAX_DIMENSION = 1280
VIDEO_MAX_DURATION_SECONDS = 90
VIDEO_PROCESS_TIMEOUT_SECONDS = 300
VIDEO_STALLED_AFTER_SECONDS = VIDEO_PROCESS_TIMEOUT_SECONDS + 60
VIDEO_MAX_INPUT_BYTES = 200 * 1024 * 1024
# ffmpeg shares the host with every other app: cap decoder and encoder threads
# and run at a lower priority so a transcode never starves the other services.
VIDEO_THREADS = 2
VIDEO_NICENESS = 10
# RLIMIT_CPU counts every thread, so the budget covers decoder and encoder
# threads running for the full wall-clock timeout.
VIDEO_CPU_SECONDS = VIDEO_PROCESS_TIMEOUT_SECONDS * 2 * VIDEO_THREADS
VIDEO_MAX_OUTPUT_BYTES = 80 * 1024 * 1024
VIDEO_MAX_MEMORY_BYTES = 2 * 1024 * 1024 * 1024
# Limits are applied in a fresh interpreter that then execs ffmpeg: a
# `preexec_fn` is unsafe here because background jobs run on worker threads.
_LIMITED_EXEC = (
    "import os, resource, sys\n"
    "cpu, size, memory, niceness = map(int, sys.argv[1:5])\n"
    "resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu))\n"
    "resource.setrlimit(resource.RLIMIT_FSIZE, (size, size))\n"
    "resource.setrlimit(resource.RLIMIT_AS, (memory, memory))\n"
    "os.nice(niceness)\n"
    "os.execvp(sys.argv[5], sys.argv[5:])\n"
)


def queue_video_derivative(
    session: Session, *, media_asset: MediaAsset, purpose: DerivativePurpose, remove_audio: bool
) -> MediaDerivative:
    if media_asset.media_kind != MediaKind.VIDEO or media_asset.original_object.state != ObjectState.AVAILABLE:
        raise MediaImportError("Video original is unavailable")
    if media_asset.original_object.byte_size > VIDEO_MAX_INPUT_BYTES:
        raise MediaImportError("Video exceeds the derivative input limit")
    derivative = MediaDerivative(
        trip_id=media_asset.trip_id, media_asset_id=media_asset.id, purpose=purpose,
        processing_state=DerivativeProcessingState.PROCESSING, remove_audio=remove_audio,
        processing_started_at=datetime.now(UTC),
        review_state=DerivativeReviewState.PENDING,
    )
    session.add(derivative)
    session.commit()
    return derivative


def _media_command(arguments: list[str]) -> subprocess.CompletedProcess[bytes]:
    limits = [str(value) for value in (VIDEO_CPU_SECONDS, VIDEO_MAX_OUTPUT_BYTES, VIDEO_MAX_MEMORY_BYTES, VIDEO_NICENESS)]
    return subprocess.run([sys.executable, "-c", _LIMITED_EXEC, *limits, *arguments], check=True, capture_output=True,
                          timeout=VIDEO_PROCESS_TIMEOUT_SECONDS)


def _copy_bounded(storage: ObjectStorage, key: str, target: Path) -> None:
    """Stream an original to disk without holding it in memory."""
    written = 0
    with storage.open(key) as source, target.open("wb") as destination:
        while chunk := source.read(1024 * 1024):
            written += len(chunk)
            if written > VIDEO_MAX_INPUT_BYTES:
                raise MediaImportError("Video exceeds the derivative input limit")
            destination.write(chunk)


def process_video_derivative(session: Session, storage: ObjectStorage, *, derivative_id: str) -> None:
    """Process one queued video. The row remains retryable after a failed transform."""
    derivative = session.get(MediaDerivative, derivative_id)
    if derivative is None or derivative.processing_state != DerivativeProcessingState.PROCESSING:
        return
    try:
        asset = derivative.media_asset
        if asset.deleted_at is not None or asset.original_object.byte_size > VIDEO_MAX_INPUT_BYTES:
            raise MediaImportError("Video original is unavailable or too large")
        with tempfile.TemporaryDirectory(prefix="travel-video-") as directory:
            source = Path(directory) / "source"
            output = Path(directory) / "share.mp4"
            poster = Path(directory) / "poster.webp"
            _copy_bounded(storage, asset.original_object.object_key, source)
            scale = f"scale=w='min({VIDEO_MAX_DIMENSION},iw)':h='min({VIDEO_MAX_DIMENSION},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2"
            threads = ["-threads", str(VIDEO_THREADS)]
            command = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", *threads, "-i", str(source),
                       *threads, "-filter_threads", "1",
                       "-map", "0:v:0", "-map_metadata", "-1", "-map_metadata:s", "-1",
                       "-map_chapters", "-1", "-dn", "-sn"]
            if derivative.remove_audio:
                command += ["-an"]
            else:
                command += ["-map", "0:a:0?", "-c:a", "aac", "-b:a", "128k"]
            command += ["-vf", scale, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast",
                        "-b:v", "1800k", "-maxrate", "2000k", "-bufsize", "4000k", "-t", str(VIDEO_MAX_DURATION_SECONDS),
                        "-movflags", "+faststart", "-y", str(output)]
            _media_command(command)
            _media_command(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", *threads, "-i", str(output),
                            "-map", "0:v:0", "-frames:v", "1", "-vf", scale, "-an", "-sn", "-dn",
                            "-map_metadata", "-1", "-map_metadata:s", "-1", "-y", str(poster)])
            probe = json.loads(_media_command(["ffprobe", "-v", "error", "-show_streams", "-show_format",
                                               "-of", "json", str(output)]).stdout)
            streams = probe["streams"]
            if any(stream["codec_type"] not in ({"video"} if derivative.remove_audio else {"video", "audio"}) for stream in streams):
                raise MediaImportError("Unexpected video stream")
            video = next(stream for stream in streams if stream["codec_type"] == "video")
            duration = float(probe["format"]["duration"])
            if max(video["width"], video["height"]) > VIDEO_MAX_DIMENSION or duration > VIDEO_MAX_DURATION_SECONDS + 0.1:
                raise MediaImportError("Video transform exceeded limits")
            video_bytes, poster_bytes = output.read_bytes(), poster.read_bytes()
        session.expire_all()
        derivative = session.get(MediaDerivative, derivative_id)
        if derivative is None or derivative.processing_state != DerivativeProcessingState.PROCESSING:
            return
        stored = _store_bytes(session, storage, trip_id=derivative.trip_id, data=video_bytes, content_type=VIDEO_CONTENT_TYPE)
        still = _store_bytes(session, storage, trip_id=derivative.trip_id, data=poster_bytes, content_type=DERIVATIVE_CONTENT_TYPE)
        derivative.object_id = stored.id
        derivative.poster_object_id = still.id
        derivative.width, derivative.height = video["width"], video["height"]
        derivative.duration_seconds = duration
        derivative.metadata_stripped_at = datetime.now(UTC)
        derivative.processing_state = DerivativeProcessingState.READY
        session.commit()
    except (MediaImportError, OSError, ValueError, KeyError, StopIteration, subprocess.SubprocessError, SQLAlchemyError):
        session.rollback()
        derivative = session.get(MediaDerivative, derivative_id)
        if derivative is not None:
            derivative.processing_state = DerivativeProcessingState.FAILED
            session.commit()


def expire_stalled_video_derivatives(session: Session, derivatives: list[MediaDerivative]) -> None:
    cutoff = datetime.now(UTC) - timedelta(seconds=VIDEO_STALLED_AFTER_SECONDS)
    stale = [item for item in derivatives if item.processing_state == DerivativeProcessingState.PROCESSING
             and item.processing_started_at is not None and _aware_utc(item.processing_started_at) < cutoff]
    if stale:
        for item in stale:
            item.processing_state = DerivativeProcessingState.FAILED
        session.commit()


def create_derivative(
    session: Session,
    storage: ObjectStorage,
    *,
    media_asset: MediaAsset,
    purpose: DerivativePurpose,
    max_dimension: int = 1600,
) -> MediaDerivative:
    """Generate a metadata-stripped, size-capped derivative of a photo.

    Reopening the original with Pillow and re-encoding it without ever
    passing an `exif=`/`icc_profile=` argument to `save()` is what strips
    EXIF/XMP/IPTC — Pillow does not carry that data over implicitly, so a
    plain re-encode is sufficient and there is nothing to explicitly scrub
    for it to leak. Orientation is preserved by baking in the EXIF rotation
    before the tag itself is dropped.
    """
    original = media_asset.original_object
    if original.state != ObjectState.AVAILABLE:
        raise MediaImportError("The original is not available")
    if media_asset.media_kind != MediaKind.PHOTO:
        raise MediaImportError("Only photo derivatives are supported")

    data = storage.get(original.object_key)
    with Image.open(io.BytesIO(data)) as opened:
        oriented = ImageOps.exif_transpose(opened)
        oriented.thumbnail((max_dimension, max_dimension))
        buffer = io.BytesIO()
        oriented.convert("RGB").save(buffer, format=DERIVATIVE_FORMAT, quality=85, method=6)
        width, height = oriented.size
    stripped = buffer.getvalue()

    stored = _store_bytes(session, storage, trip_id=media_asset.trip_id, data=stripped, content_type=DERIVATIVE_CONTENT_TYPE)
    derivative = MediaDerivative(
        trip_id=media_asset.trip_id,
        media_asset_id=media_asset.id,
        object_id=stored.id,
        purpose=purpose,
        metadata_stripped_at=datetime.now(UTC),
        review_state=DerivativeReviewState.PENDING,
        width=width,
        height=height,
    )
    session.add(derivative)
    session.commit()
    return derivative


def delete_media_asset(session: Session, *, media_asset: MediaAsset) -> None:
    """Soft-delete: gone from owner queries immediately. Physical bytes are
    purged later by `purge_deleted_media`, after the recoverable-deletion
    window, never synchronously here."""
    # A removed original is no longer an attachment. Keep no hidden link on a
    # reisupdate that might later be mistaken for a publishable reference.
    for link in list(media_asset.update_links):
        session.delete(link)
    media_asset.deleted_at = datetime.now(UTC)
    session.commit()


def delete_media_derivative(session: Session, storage: ObjectStorage, *, derivative: MediaDerivative) -> None:
    """Remove a disposable derivative and its now-unreferenced stored copy.

    Original media gets a recoverable-deletion period. Generated derivatives
    do not: once the owner deletes one it must disappear immediately.
    """
    object_ids = [value for value in (derivative.object_id, derivative.poster_object_id) if value]
    session.delete(derivative)
    session.flush()
    for object_id in object_ids:
        if not _object_is_referenced(session, object_id):
            session.get(StoredObject, object_id).state = ObjectState.PURGE_PENDING
    session.commit()
    _purge_pending_objects(session, storage, object_ids=object_ids)


def purge_deleted_media(session: Session, storage: ObjectStorage, *, older_than: timedelta) -> int:
    """Hard-delete soft-deleted media past the recoverable-deletion window
    and reclaim their unreferenced stored objects. Commit the database changes
    before touching files; pending objects remain retryable if deletion fails.
    Returns the number of objects purged."""
    cutoff = datetime.now(UTC) - older_than
    expired_assets = session.scalars(
        select(MediaAsset).where(MediaAsset.deleted_at.is_not(None), MediaAsset.deleted_at < cutoff)
    ).all()
    object_ids: set[str] = set()
    for asset in expired_assets:
        object_ids.add(asset.original_object_id)
        object_ids.update(value for derivative in asset.derivatives
                          for value in (derivative.object_id, derivative.poster_object_id) if value)
        for derivative in list(asset.derivatives):
            session.delete(derivative)
        session.delete(asset)
    session.flush()
    for object_id in object_ids:
        stored = session.get(StoredObject, object_id)
        if stored is not None and not _object_is_referenced(session, object_id):
            stored.state = ObjectState.PURGE_PENDING
    session.commit()

    purged = _purge_pending_objects(session, storage)
    # The same scheduled storage purge retries failed owner-library deletions.
    from ..library.service import purge_owner_objects

    return purged + purge_owner_objects(session, storage)


def _purge_pending_objects(session: Session, storage: ObjectStorage, *, object_ids: list[str] | None = None) -> int:
    purged = 0
    if object_ids is None:
        object_ids = session.scalars(select(StoredObject.id).where(StoredObject.state == ObjectState.PURGE_PENDING)).all()
    for object_id in object_ids:
        # A failed file deletion or commit leaves this unreferenced row for a
        # later run; the lock prevents an upload from reusing it meanwhile.
        stored = session.scalar(select(StoredObject).where(StoredObject.id == object_id).with_for_update())
        if stored is None or stored.state != ObjectState.PURGE_PENDING:
            session.rollback()
            continue
        if _object_is_referenced(session, object_id):
            stored.state = ObjectState.AVAILABLE
            session.commit()
            continue
        storage.delete(stored.object_key)
        session.delete(stored)
        session.commit()
        purged += 1
    return purged


def _object_is_referenced(session: Session, object_id: str) -> bool:
    """Include every trip-scoped resource that can share stored bytes."""
    references = (
        (MediaAsset, MediaAsset.original_object_id),
        (MediaDerivative, MediaDerivative.object_id),
        (MediaDerivative, MediaDerivative.poster_object_id),
        (DocumentAsset, DocumentAsset.original_object_id),
    )
    return any(session.scalar(select(model.id).where(column == object_id)) is not None for model, column in references)
