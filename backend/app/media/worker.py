"""Backend-only apps#273 v1 transport and durable, single-step reconciliation.

Run ``uv run python -m app.media.worker`` as a supervised dispatcher. Rows,
not a process-local task, own retries; PostgreSQL row locks serialize dispatchers.
"""

import hashlib
import io
import json
import math
import re
import subprocess
import tempfile
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
from PIL import Image
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from ..config import settings
from ..database import SessionLocal
from ..models import DerivativeProcessingState, MediaAsset, MediaDerivative, MediaWorkerJob, ObjectState, StoredObject
from ..storage import ObjectStorage, get_storage, sha256_hex
from . import service

PROFILE = "travel-video-v1"
ID = re.compile(r"[a-f0-9]{32}\Z")
HASH = re.compile(r"[a-f0-9]{64}\Z")
STATES = {"queued", "running", "succeeded", "failed", "cancelled", "expired"}


class WorkerUnavailable(Exception):
    """Retryable, content-free transport/configuration failure."""


class AbsentSubmission(Exception):
    """Deleted work was never accepted (or its tombstone has expired)."""


class InvalidOutput(Exception):
    """Terminal output contract failure; never publish partial output."""


class TimedUpload:
    """httpx multipart pulls bounded chunks; enforce a complete upload deadline too."""

    def __init__(self, file) -> None:
        self.file = file
        self.deadline = time.monotonic() + 120

    def read(self, size: int = -1) -> bytes:
        if time.monotonic() > self.deadline:
            raise WorkerUnavailable
        return self.file.read(size)

    def seek(self, offset: int, whence: int = 0) -> int:
        return self.file.seek(offset, whence)

    def tell(self) -> int:
        return self.file.tell()


class WorkerClient:
    def __init__(self) -> None:
        try:
            token = Path(settings.media_worker_token_file).read_text().strip()
        except OSError:
            raise WorkerUnavailable from None
        url = httpx.URL(settings.media_worker_url)
        if (
            url.scheme not in {"http", "https"}
            or not url.host
            or url.userinfo
            or url.query
            or url.fragment
            or url.path not in {"", "/"}
            or len(token) < 32
            or not token.isascii()
            or any(c.isspace() for c in token)
            or settings.media_worker_profile != PROFILE
        ):
            raise WorkerUnavailable
        self.http = httpx.Client(
            base_url=str(url).rstrip("/"),
            headers={"Authorization": f"Bearer {token}"},
            timeout=httpx.Timeout(120, connect=5),
            trust_env=False,
            follow_redirects=False,
        )

    def close(self) -> None:
        self.http.close()

    def request(self, method: str, path: str, *, limit: int = 64 * 1024, **kwargs) -> tuple[int, bytes]:
        start = time.monotonic()
        with self.http.stream(method, path, **kwargs) as response:
            data = bytearray()
            for chunk in response.iter_bytes(64 * 1024):
                if len(data) + len(chunk) > limit or time.monotonic() - start > 130:
                    raise WorkerUnavailable
                data.extend(chunk)
            return response.status_code, bytes(data)

    def job(self, method: str, path: str, **kwargs) -> dict:
        status, data = self.request(method, path, **kwargs)
        if status not in {200, 202}:
            # Admission, outage, authentication and uncertain submissions all back off.
            # 404/410 after an ID was saved are terminal lost/expired worker work.
            if method == "GET" and status in {404, 410}:
                return {"api_version": "v1", "id": path.rsplit("/", 1)[-1], "state": "expired"}
            raise WorkerUnavailable
        return self.parse_job(data)

    @staticmethod
    def parse_job(data: bytes) -> dict:
        try:
            result = json.loads(data)
            if result["api_version"] != "v1" or not ID.fullmatch(result["id"]) or result["state"] not in STATES:
                raise ValueError
            return result
        except (ValueError, KeyError, TypeError):
            raise WorkerUnavailable from None

    def submit(self, job: MediaWorkerJob, source: Path | None) -> dict:
        manifest = {"profile": job.profile, "remove_audio": job.remove_audio}
        payload = {"manifest": manifest, "sha256": [job.source_sha256]}
        digest = sha256_hex(json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode())
        headers = {"Idempotency-Key": job.id, "X-Payload-SHA256": digest}
        if source is None:
            # Resolve a possibly accepted submission after deletion, without sending original bytes again.
            status, data = self.request("POST", "/v1/jobs", headers=headers)
            if status == 400:
                raise AbsentSubmission
            if status not in {200, 202}:
                raise WorkerUnavailable
            return self.parse_job(data)
        with source.open("rb") as file:
            return self.job(
                "POST",
                "/v1/jobs",
                headers=headers,
                files=[
                    ("manifest", (None, json.dumps(manifest), "application/json")),
                    ("file", ("input", TimedUpload(file), "application/octet-stream")),
                ],
            )

    def download(self, worker_id: str, name: str, evidence: dict) -> bytes:
        try:
            if (
                type(evidence["bytes"]) is not int
                or not 0 < evidence["bytes"] <= service.VIDEO_MAX_OUTPUT_BYTES
                or not HASH.fullmatch(evidence["sha256"])
                or evidence["content_type"] != {"video.mp4": "video/mp4", "poster.webp": "image/webp"}[name]
            ):
                raise InvalidOutput
            status, data = self.request("GET", f"/v1/jobs/{worker_id}/artifacts/{name}", limit=evidence["bytes"])
            if status == 410:
                raise InvalidOutput
            if status != 200:
                raise WorkerUnavailable
            if len(data) != evidence["bytes"] or sha256_hex(data) != evidence["sha256"]:
                raise InvalidOutput
            return data
        except (KeyError, TypeError):
            raise InvalidOutput from None

    def cleanup(self, worker_id: str, *, cancel: bool) -> None:
        if cancel:
            status, _ = self.request("POST", f"/v1/jobs/{worker_id}/cancel")
            if status not in {200, 204, 404}:
                raise WorkerUnavailable
        status, _ = self.request("DELETE", f"/v1/jobs/{worker_id}/artifacts")
        if status not in {204, 404, 410}:
            raise WorkerUnavailable


def retire(session: Session, derivative_id: str) -> None:
    previous = session.scalar(
        select(MediaWorkerJob).where(MediaWorkerJob.derivative_id == derivative_id).with_for_update()
    )
    if previous:
        previous.derivative_id = None
        session.flush()


def enqueue(session: Session, derivative: MediaDerivative) -> None:
    # A retry is a new attempt/key. Old work retains its own cancellation outbox.
    retire(session, derivative.id)
    original = derivative.media_asset.original_object
    session.add(
        MediaWorkerJob(
            derivative_id=derivative.id,
            profile=settings.media_worker_profile,
            remove_audio=derivative.remove_audio,
            source_key=original.object_key,
            source_sha256=original.sha256,
        )
    )


def validate_output(
    video_bytes: bytes, poster_bytes: bytes, artifacts: dict, remove_audio: bool
) -> tuple[int, int, float]:
    """Verify worker evidence against the actual bytes with the retained pinned ffprobe."""
    with tempfile.TemporaryDirectory(prefix="travel-worker-verify-") as directory:
        path = Path(directory) / "video.mp4"
        path.write_bytes(video_bytes)
        probe = json.loads(
            service._media_command(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-protocol_whitelist",
                    "file",
                    "-format_whitelist",
                    "mov",
                    "-show_streams",
                    "-show_format",
                    "-show_chapters",
                    "-of",
                    "json",
                    str(path),
                ]
            ).stdout
        )
    streams = probe["streams"]
    videos = [s for s in streams if s["codec_type"] == "video"]
    audio = [s for s in streams if s["codec_type"] == "audio"]
    if len(videos) != 1 or len(audio) > (0 if remove_audio else 1):
        raise InvalidOutput
    video = videos[0]
    width, height = video["width"], video["height"]
    duration = float(probe["format"]["duration"])
    if (
        video["codec_name"] != "h264"
        or video["pix_fmt"] != "yuv420p"
        or not 0 < width <= 1280
        or not 0 < height <= 1280
        or width % 2
        or height % 2
        or not math.isfinite(duration)
        or not 0 < duration <= 90.1
        or any(s["codec_type"] not in {"audio", "video"} for s in streams)
        or any(s["codec_name"] != "aac" for s in audio)
        or probe.get("chapters")
        or set(probe["format"].get("tags", {})) - {"major_brand", "minor_version", "compatible_brands", "encoder"}
        or any(set(s.get("tags", {})) - {"language", "handler_name", "vendor_id", "encoder"} for s in streams)
        or any(s.get("side_data_list") for s in streams)
    ):
        raise InvalidOutput
    for name in ("video.mp4", "poster.webp"):
        if (artifacts[name]["width"], artifacts[name]["height"]) != (width, height):
            raise InvalidOutput
    if abs(float(artifacts["video.mp4"]["duration_seconds"]) - duration) > 0.01:
        raise InvalidOutput
    with Image.open(io.BytesIO(poster_bytes)) as poster:
        if (
            poster.format != "WEBP"
            or poster.size != (width, height)
            or any(k in poster.info for k in ("exif", "xmp", "icc_profile"))
        ):
            raise InvalidOutput
        poster.load()
    return width, height, duration


def active_derivative(session: Session, job: MediaWorkerJob) -> MediaDerivative | None:
    derivative = session.scalar(
        select(MediaDerivative).where(MediaDerivative.id == job.derivative_id).with_for_update()
    )
    if derivative is None or derivative.processing_state != DerivativeProcessingState.PROCESSING:
        return None
    asset = session.scalar(select(MediaAsset).where(MediaAsset.id == derivative.media_asset_id).with_for_update())
    if (
        asset is None
        or asset.deleted_at is not None
        or asset.trip_id != derivative.trip_id
        or asset.original_object.state != ObjectState.AVAILABLE
        or asset.original_object.object_key != job.source_key
        or asset.original_object.sha256 != job.source_sha256
    ):
        return None
    return derivative


def discard_unrecorded_outputs(session: Session, storage: ObjectStorage, job: MediaWorkerJob) -> None:
    # Deterministic keys make interrupted imports overwrite their own staging bytes.
    # Keep canonical rows; delete only bytes left by a rolled-back import.
    for name in ("video.mp4", "poster.webp"):
        key = f"worker-{job.id}/{name}"
        if session.scalar(select(StoredObject.id).where(StoredObject.object_key == key)) is None:
            storage.delete(key)


def reconcile(session: Session, storage: ObjectStorage, job: MediaWorkerJob, client: WorkerClient) -> None:
    derivative = active_derivative(session, job)
    if job.state == "ack":
        assert job.worker_id is not None
        client.cleanup(job.worker_id, cancel=False)
        job.state = "done"
    elif job.worker_id is None:
        if job.state == "submitting" and service._aware_utc(job.created_at) < datetime.now(UTC) - timedelta(days=6):
            # apps#273 retains tombstones seven days. Never replay beyond that identity window.
            if derivative:
                derivative.processing_state = DerivativeProcessingState.FAILED
            job.state = "done"
            job.error_code = "submission_expired"
            session.commit()
            return
        if derivative is None and job.state == "pending":
            job.state = "done"  # No request was ever attempted.
        else:
            # Persist uncertainty BEFORE touching the network. The same key resolves a lost response.
            job.state = "submitting"
            session.commit()
            locked = session.scalar(select(MediaWorkerJob).where(MediaWorkerJob.id == job.id).with_for_update())
            assert locked is not None
            job = locked
            if job.state != "submitting":
                return
            derivative = active_derivative(session, job)
            with tempfile.TemporaryDirectory(prefix="travel-worker-upload-") as directory:
                source = None
                if derivative is not None:
                    source = Path(directory) / "input"
                    service._copy_bounded(storage, job.source_key, source)
                    with source.open("rb") as file:
                        if hashlib.file_digest(file, "sha256").hexdigest() != job.source_sha256:
                            raise InvalidOutput
                result = client.submit(job, source)
            job.worker_id = result["id"]
            job.state = result["state"]
            # Submission and import are separate durable steps, including immediate success.
    elif derivative is None:
        client.cleanup(job.worker_id, cancel=True)
        job.state = "done"
    else:
        result = client.job("GET", f"/v1/jobs/{job.worker_id}")
        if result["id"] != job.worker_id:
            raise WorkerUnavailable
        job.state = result["state"]
        if job.state == "succeeded":
            artifacts = result["artifacts"]
            if set(artifacts) != {"video.mp4", "poster.webp"}:
                raise InvalidOutput
            video = client.download(job.worker_id, "video.mp4", artifacts["video.mp4"])
            poster = client.download(job.worker_id, "poster.webp", artifacts["poster.webp"])
            try:
                width, height, duration = validate_output(video, poster, artifacts, job.remove_audio)
            except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError):
                raise InvalidOutput from None
            # Locks on derivative + asset span validation and attachment, preventing deletion races.
            stored = service._store_bytes(
                session,
                storage,
                trip_id=derivative.trip_id,
                data=video,
                content_type="video/mp4",
                object_key=f"worker-{job.id}/video.mp4",
            )
            still = service._store_bytes(
                session,
                storage,
                trip_id=derivative.trip_id,
                data=poster,
                content_type="image/webp",
                object_key=f"worker-{job.id}/poster.webp",
            )
            derivative.object_id, derivative.poster_object_id = stored.id, still.id
            derivative.width, derivative.height, derivative.duration_seconds = width, height, duration
            derivative.metadata_stripped_at = datetime.now(UTC)
            derivative.processing_state = DerivativeProcessingState.READY
            job.state = "ack"  # ACK can only happen in a later transaction, after canonical commit.
        elif job.state in {"failed", "cancelled", "expired"}:
            derivative.processing_state = DerivativeProcessingState.FAILED
            job.state = "ack"
    if job.state == "done":
        discard_unrecorded_outputs(session, storage, job)
    job.error_code = None
    job.attempts = 0
    job.next_attempt_at = datetime.now(UTC) + timedelta(seconds=5)
    session.commit()


def dispatch_one(session: Session, storage: ObjectStorage, client: WorkerClient) -> bool:
    job = session.scalar(
        select(MediaWorkerJob)
        .where(
            MediaWorkerJob.state != "done",
            MediaWorkerJob.next_attempt_at <= datetime.now(UTC),
        )
        .order_by(MediaWorkerJob.next_attempt_at)
        .with_for_update(skip_locked=True)
        .limit(1)
    )
    if job is None:
        return False
    job_id = job.id
    try:
        reconcile(session, storage, job, client)
    except Exception as error:
        # Roll back failed storage writes/imports. Keep diagnostics content-free and persisted.
        session.rollback()
        job = session.scalar(select(MediaWorkerJob).where(MediaWorkerJob.id == job_id).with_for_update())
        if job is None:
            return True
        if isinstance(error, AbsentSubmission):
            job.state = "done"
            job.error_code = None
        elif isinstance(error, InvalidOutput) or (
            isinstance(error, service.MediaImportError)
            and error.code != "stored_object_failed_checksum_verification_after_write"
        ):
            derivative = active_derivative(session, job)
            if derivative:
                derivative.processing_state = DerivativeProcessingState.FAILED
            job.state = "ack" if job.worker_id else "done"
            job.error_code = "output_invalid"
        else:
            job.error_code = "worker_unavailable"
        job.attempts += 1
        job.next_attempt_at = datetime.now(UTC) + timedelta(seconds=min(300, 5 * 2 ** min(job.attempts, 6)))
        session.commit()
    return True


def main() -> None:
    while True:
        try:
            client = WorkerClient()
            try:
                with SessionLocal() as session:
                    worked = dispatch_one(session, get_storage(), client)
            finally:
                client.close()
        except (WorkerUnavailable, httpx.HTTPError, OSError, ValueError, SQLAlchemyError):
            worked = False
        if not worked:
            time.sleep(5)


if __name__ == "__main__":
    main()
