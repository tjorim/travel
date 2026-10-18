"""Remote transport/lifecycle, using real stripped MP4/WebP bytes and v1 wire fixtures."""

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
from PIL import Image
from sqlalchemy import select
from test_media import (
    TestingSessionLocal,
    client_for,
    create_trip,
    setup_function,
    teardown_function,
    video_with_telemetry,
)

from app.config import settings
from app.media import service, worker
from app.models import (
    DerivativeProcessingState,
    DerivativePurpose,
    DerivativeReviewState,
    MediaAsset,
    MediaDerivative,
    MediaWorkerJob,
    StoredObject,
)
from app.storage import LocalObjectStorage, sha256_hex

WORKER_ID = "a" * 32


@pytest.fixture(autouse=True)
def database():
    setup_function()
    yield
    teardown_function()


@pytest.fixture
def queued(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "video_processing_backend", "remote")
    client = client_for("owner-1", tmp_path)
    trip = create_trip(client)
    storage = LocalObjectStorage(str(tmp_path))
    with TestingSessionLocal() as session:
        asset, _ = service.direct_upload(
            session,
            storage,
            trip_id=trip["id"],
            filename="private.mov",
            content_type="video/quicktime",
            data=video_with_telemetry(tmp_path),
        )
        path = f"/api/trips/{trip['id']}/media/{asset.id}/derivatives"
    # Remote API requests create only durable work, and never invoke ffmpeg/background transforms.
    with monkeypatch.context() as request_patch:
        request_patch.setattr(service, "_process_video_derivative", lambda *a, **k: pytest.fail("local fallback"))
        response = client.post(path, json={"purpose": "share", "remove_audio": True})
    assert response.status_code == 201, response.text
    assert "worker" not in response.text and "source_key" not in response.text
    return client, path, response.json()["id"], storage


@pytest.fixture
def transport(tmp_path, monkeypatch):
    token = tmp_path / "token"
    token.write_text("t" * 64)
    monkeypatch.setattr(settings, "media_worker_url", "http://media-worker:8090")
    monkeypatch.setattr(settings, "media_worker_token_file", str(token))
    calls = []
    replies = []

    def respond(request):
        assert request.headers["Authorization"] == "Bearer " + "t" * 64
        calls.append(request)
        reply = replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply

    client = worker.WorkerClient()
    client.http.close()
    client.http = httpx.Client(
        base_url="http://media-worker:8090",
        transport=httpx.MockTransport(respond),
        headers={"Authorization": "Bearer " + "t" * 64},
        follow_redirects=False,
    )
    yield client, calls, replies
    client.close()


def status(state="queued", **fields):
    return httpx.Response(200, json={"api_version": "v1", "id": WORKER_ID, "state": state, **fields})


def tick(storage, client):
    with TestingSessionLocal() as session:
        for job in session.scalars(select(MediaWorkerJob).where(MediaWorkerJob.state != "done")):
            job.next_attempt_at = datetime.now(UTC) - timedelta(seconds=1)
        session.commit()
        return worker.dispatch_one(session, storage, client)


def test_lost_submit_response_reuses_durable_key_after_restart(queued, transport):
    _, _, derivative_id, storage = queued
    client, calls, replies = transport
    replies.append(httpx.ReadTimeout("private server prose must never persist"))
    tick(storage, client)
    with TestingSessionLocal() as session:
        job = session.scalar(select(MediaWorkerJob))
        assert job.state == "submitting" and job.worker_id is None
        assert job.error_code == "worker_unavailable" and job.attempts == 1
        key = job.id
    replies.append(status())
    tick(storage, client)
    assert [r.headers["Idempotency-Key"] for r in calls] == [key, key]
    assert calls[0].headers["X-Payload-SHA256"] == calls[1].headers["X-Payload-SHA256"]
    assert b'"profile": "travel-video-v1"' in calls[0].content
    assert b"private.mov" not in calls[0].content
    with TestingSessionLocal() as session:
        job = session.scalar(select(MediaWorkerJob))
        assert job.worker_id == WORKER_ID and job.state == "queued"
        derivative = session.get(MediaDerivative, derivative_id)
        derivative.processing_started_at = datetime.now(UTC) - timedelta(days=2)
        session.commit()
        service.expire_stalled_video_derivatives(session, [derivative])
        assert derivative.processing_state == DerivativeProcessingState.PROCESSING
    replies.append(status("running"))
    tick(storage, client)
    with TestingSessionLocal() as session:
        assert session.scalar(select(MediaWorkerJob)).state == "running"


def test_delete_after_uncertain_submission_resolves_then_cancels_without_original(queued, transport):
    owner, path, derivative_id, storage = queued
    client, calls, replies = transport
    replies.append(httpx.ReadTimeout("lost"))
    tick(storage, client)
    assert owner.delete(f"{path}/{derivative_id}").status_code == 204
    replies.append(status())
    tick(storage, client)
    assert not calls[-1].content
    replies.extend([status("cancelled"), httpx.Response(204)])
    tick(storage, client)
    assert calls[-2].url.path.endswith("/cancel")
    with TestingSessionLocal() as session:
        assert session.get(MediaDerivative, derivative_id) is None
        assert session.scalar(select(MediaWorkerJob)).state == "done"


def test_deleted_unsubmitted_job_sends_no_original(queued, transport):
    owner, path, derivative_id, storage = queued
    client, calls, _ = transport
    assert owner.delete(f"{path}/{derivative_id}").status_code == 204
    tick(storage, client)
    assert calls == []


@pytest.mark.parametrize("reply", [status("expired"), status("failed"), httpx.Response(404)])
def test_expired_or_failed_job_requires_explicit_retry(queued, transport, reply):
    owner, path, derivative_id, storage = queued
    client, calls, replies = transport
    replies.extend([status(), reply])
    tick(storage, client)
    tick(storage, client)
    assert owner.get(f"{path}/{derivative_id}").json()["processing_state"] == "failed"
    with TestingSessionLocal() as session:
        old = session.scalar(select(MediaWorkerJob))
        old_key = old.id
    assert owner.post(f"{path}/{derivative_id}/retry").status_code == 200
    with TestingSessionLocal() as session:
        jobs = list(session.scalars(select(MediaWorkerJob)))
        assert len(jobs) == 2
        assert session.get(MediaWorkerJob, old_key).derivative_id is None
        assert next(j for j in jobs if j.derivative_id).id != old_key
    assert len(calls) == 2


def test_explicit_local_rollback_does_not_fallback_outstanding_remote_job(queued, transport, monkeypatch):
    _, _, derivative_id, storage = queued
    client, _, replies = transport
    monkeypatch.setattr(settings, "video_processing_backend", "local")
    with TestingSessionLocal() as session:
        service.process_video_derivative(session, storage, derivative_id=derivative_id)
    replies.append(status())
    tick(storage, client)
    with TestingSessionLocal() as session:
        assert session.scalar(select(MediaWorkerJob)).worker_id == WORKER_ID


@pytest.mark.parametrize(
    "reply",
    [
        httpx.Response(429),
        httpx.Response(503),
        httpx.Response(302, headers={"Location": "https://elsewhere.test"}),
        httpx.Response(200, content=b"{}"),
    ],
)
def test_admission_outage_redirect_and_malformed_status_back_off(queued, transport, reply):
    _, _, derivative_id, storage = queued
    client, calls, replies = transport
    replies.append(reply)
    tick(storage, client)
    with TestingSessionLocal() as session:
        assert session.get(MediaDerivative, derivative_id).processing_state == DerivativeProcessingState.PROCESSING
        job = session.scalar(select(MediaWorkerJob))
        assert job.error_code == "worker_unavailable" and job.next_attempt_at > datetime.now(UTC).replace(tzinfo=None)
    assert len(calls) == 1


def outputs(tmp_path: Path, remove_audio: bool):
    """Synthetic worker-profile output: real codec, stripped metadata and separate WebP."""
    import subprocess

    source, target, poster = (tmp_path / name for name in ("fixture.mov", "fixture.mp4", "fixture.webp"))
    source.write_bytes(video_with_telemetry(tmp_path))
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-threads",
            "2",
            "-i",
            str(source),
            "-map",
            "0:v:0",
            "-map_metadata",
            "-1",
            "-map_metadata:s",
            "-1",
            "-map_chapters",
            "-1",
            "-sn",
            "-dn",
            *(["-an"] if remove_audio else ["-map", "0:a:0?", "-c:a", "aac"]),
            "-threads",
            "2",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-y",
            str(target),
        ],
        check=True,
        capture_output=True,
    )
    Image.new("RGB", (640, 360)).save(poster, format="WEBP")
    data = {"video.mp4": target.read_bytes(), "poster.webp": poster.read_bytes()}
    evidence = {
        name: {
            "bytes": len(value),
            "sha256": sha256_hex(value),
            "width": 640,
            "height": 360,
            "content_type": "video/mp4" if name.endswith("mp4") else "image/webp",
        }
        for name, value in data.items()
    }
    import subprocess as sp

    probe = json.loads(sp.check_output(["ffprobe", "-v", "error", "-show_format", "-of", "json", str(target)]))
    evidence["video.mp4"]["duration_seconds"] = float(probe["format"]["duration"])
    return data, evidence


def test_atomic_import_ack_loss_and_duplicate_poll_cannot_duplicate_objects(queued, transport, tmp_path):
    owner, path, derivative_id, storage = queued
    client, calls, replies = transport
    data, evidence = outputs(tmp_path, True)
    replies.extend(
        [
            status(),
            status("succeeded", artifacts=evidence),
            *[httpx.Response(200, content=data[n]) for n in ("video.mp4", "poster.webp")],
        ]
    )
    tick(storage, client)
    tick(storage, client)
    # No ACK until both canonical objects and the ready derivative are durably committed.
    assert all(r.method != "DELETE" for r in calls)
    response = owner.get(f"{path}/{derivative_id}").json()
    assert response["processing_state"] == "ready" and response["review_state"] == "pending"
    assert "worker_id" not in response
    with TestingSessionLocal() as session:
        count = len(list(session.scalars(select(StoredObject))))
        assert session.scalar(select(MediaWorkerJob)).state == "ack"
    replies.append(httpx.ReadTimeout("ACK lost"))
    tick(storage, client)
    replies.append(httpx.Response(204))
    tick(storage, client)
    assert not tick(storage, client)
    with TestingSessionLocal() as session:
        assert len(list(session.scalars(select(StoredObject)))) == count == 3
        assert session.get(MediaDerivative, derivative_id).review_state == DerivativeReviewState.PENDING
        assert session.scalar(select(MediaWorkerJob)).state == "done"


def test_corrupt_download_never_attaches_partial_video_or_falls_back(queued, transport, tmp_path):
    _, _, derivative_id, storage = queued
    client, _, replies = transport
    data, evidence = outputs(tmp_path, True)
    replies.extend([status(), status("succeeded", artifacts=evidence), httpx.Response(200, content=b"corrupt")])
    tick(storage, client)
    tick(storage, client)
    with TestingSessionLocal() as session:
        derivative = session.get(MediaDerivative, derivative_id)
        assert derivative.processing_state == DerivativeProcessingState.FAILED
        assert derivative.object_id is None and derivative.poster_object_id is None
        assert len(list(session.scalars(select(StoredObject)))) == 1


@pytest.mark.parametrize("remove_audio", [True, False])
def test_profile_verification_checks_real_streams_and_evidence(tmp_path, remove_audio):
    data, evidence = outputs(tmp_path, remove_audio)
    assert worker.validate_output(data["video.mp4"], data["poster.webp"], evidence, remove_audio)[:2] == (640, 360)
    evidence["video.mp4"]["width"] = 1282
    with pytest.raises(worker.InvalidOutput):
        worker.validate_output(data["video.mp4"], data["poster.webp"], evidence, remove_audio)


def test_soft_delete_during_encoding_cancels_and_leaves_no_late_output(queued, transport):
    owner, path, derivative_id, storage = queued
    client, _, replies = transport
    replies.append(status("running"))
    tick(storage, client)
    asset_path = path.removesuffix("/derivatives")
    assert owner.delete(asset_path).status_code == 204
    replies.extend([status("cancelled"), httpx.Response(204)])
    tick(storage, client)
    with TestingSessionLocal() as session:
        derivative = session.get(MediaDerivative, derivative_id)
        assert derivative.processing_state == DerivativeProcessingState.FAILED
        assert derivative.object_id is None
        assert session.get(MediaAsset, derivative.media_asset_id).deleted_at is not None


def test_worker_credential_validation_fails_closed(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "media_worker_token_file", str(tmp_path / "missing"))
    with pytest.raises(worker.WorkerUnavailable):
        worker.WorkerClient()
    token = tmp_path / "bad"
    token.write_text("t" * 35 + "\nembedded")
    monkeypatch.setattr(settings, "media_worker_token_file", str(token))
    with pytest.raises(worker.WorkerUnavailable):
        worker.WorkerClient()


def test_interrupted_result_import_reuses_storage_keys_before_ack(queued, transport, tmp_path, monkeypatch):
    owner, path, derivative_id, storage = queued
    client, _, replies = transport
    data, evidence = outputs(tmp_path, True)
    replies.append(status())
    tick(storage, client)
    original_put = storage.put
    failed = False

    def put(key, content):
        nonlocal failed
        if key.endswith("poster.webp") and not failed:
            failed = True
            raise OSError("storage temporarily unavailable")
        original_put(key, content)

    monkeypatch.setattr(storage, "put", put)
    for _ in range(2):
        replies.extend(
            [
                status("succeeded", artifacts=evidence),
                *[httpx.Response(200, content=data[n]) for n in ("video.mp4", "poster.webp")],
            ]
        )
        tick(storage, client)
        if failed:
            with TestingSessionLocal() as session:
                d = session.get(MediaDerivative, derivative_id)
                if d.processing_state == DerivativeProcessingState.PROCESSING:
                    assert d.object_id is None and d.poster_object_id is None
    assert owner.get(f"{path}/{derivative_id}").json()["processing_state"] == "ready"
    assert len(list(tmp_path.glob("worker-*/*"))) == 2
    with TestingSessionLocal() as session:
        assert len(list(session.scalars(select(StoredObject)))) == 3


def test_uncertain_submission_never_replays_after_worker_identity_window(queued, transport):
    _, _, derivative_id, storage = queued
    client, calls, replies = transport
    replies.append(httpx.ReadTimeout("lost"))
    tick(storage, client)
    with TestingSessionLocal() as session:
        job = session.scalar(select(MediaWorkerJob))
        job.created_at = datetime.now(UTC) - timedelta(days=7)
        session.commit()
    tick(storage, client)
    assert len(calls) == 1
    with TestingSessionLocal() as session:
        assert session.get(MediaDerivative, derivative_id).processing_state == DerivativeProcessingState.FAILED
        assert session.scalar(select(MediaWorkerJob)).error_code == "submission_expired"


def test_worker_payload_digest_matches_apps_contract_fixture(transport, tmp_path):
    client, calls, replies = transport
    replies.append(status())
    source = tmp_path / "input"
    source.write_bytes(b"fixture")
    job = MediaWorkerJob(
        id="b" * 32,
        profile="travel-video-v1",
        remove_audio=True,
        source_sha256="dcd818fc6586a9c9146a5abbfc720e276a98f43aa0a984080694f05aca130945",
    )
    client.submit(job, source)
    assert calls[0].headers["X-Payload-SHA256"] == "468695ed535b675975075de51b2784f84b298e2d3227c1dcbaa7270802d632d5"


def test_remote_ready_still_requires_review_before_public_range_delivery(queued, transport, tmp_path):
    owner, path, derivative_id, storage = queued
    client, _, replies = transport
    data, evidence = outputs(tmp_path, True)
    replies.extend(
        [
            status(),
            status("succeeded", artifacts=evidence),
            *[httpx.Response(200, content=data[n]) for n in ("video.mp4", "poster.webp")],
        ]
    )
    tick(storage, client)
    tick(storage, client)
    base = path.split("/media/")[0]
    visibility = f"{base}/visibility/media_derivative/{derivative_id}"
    assert owner.put(visibility, json={"visibility": "everyone"}).status_code == 422
    assert owner.post(f"{path}/{derivative_id}/approve").status_code == 200
    assert owner.put(visibility, json={"visibility": "everyone"}).status_code == 200
    assert (
        owner.put(
            f"{base}/public-projection",
            json={"schema_version": "travel/share-scope@1", "trip": {"title": True}, "items": []},
        ).status_code
        == 200
    )
    slug = owner.post(f"{base}/public-projection/publish").json()["slug"]
    projection = owner.get(f"/api/public/trips/{slug}").json()
    assert "private.mov" not in json.dumps(projection) and "worker" not in json.dumps(projection)
    item = projection["media"][0]
    video = owner.get(f"/api/public/trips/{slug}/files/{item['id']}", headers={"Range": "bytes=0-99"})
    assert video.status_code == 206 and video.content == data["video.mp4"][:100]
    poster = owner.get(f"/api/public/trips/{slug}/files/{item['id']}-poster")
    assert poster.content == data["poster.webp"]


# These use the actual disposable apps worker; ordinary CI runs the deterministic wire fixtures above.
@pytest.mark.parametrize("remove_audio,rotate", [(True, False), (False, False), (True, True)])
def test_real_worker_privacy_audio_rotation_parity(tmp_path, monkeypatch, remove_audio, rotate):
    import os
    import subprocess
    import time

    url = os.environ.get("TRAVEL_TEST_MEDIA_WORKER_URL")
    token_file = os.environ.get("TRAVEL_TEST_MEDIA_WORKER_TOKEN_FILE")
    if not url or not token_file:
        pytest.skip("disposable apps worker URL/token file not configured")
    monkeypatch.setattr(settings, "video_processing_backend", "remote")
    monkeypatch.setattr(settings, "media_worker_url", url)
    monkeypatch.setattr(settings, "media_worker_token_file", token_file)
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    storage = LocalObjectStorage(str(tmp_path / "objects"))
    source = video_with_telemetry(tmp_path)
    if rotate:
        target = tmp_path / "rotated.mov"
        subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-display_rotation",
                "90",
                "-i",
                str(tmp_path / "source.mov"),
                "-map",
                "0",
                "-c",
                "copy",
                "-y",
                str(target),
            ],
            check=True,
            capture_output=True,
        )
        source = target.read_bytes()
    with TestingSessionLocal() as session:
        asset, _ = service.direct_upload(
            session, storage, trip_id=trip["id"], filename="private.mov", content_type="video/quicktime", data=source
        )
        derivative = service.queue_video_derivative(
            session, media_asset=asset, purpose=DerivativePurpose.SHARE, remove_audio=remove_audio
        )
        derivative_id = derivative.id
    client = worker.WorkerClient()
    try:
        for _ in range(100):
            tick(storage, client)
            with TestingSessionLocal() as session:
                derivative = session.get(MediaDerivative, derivative_id)
                job = session.scalar(select(MediaWorkerJob))
                assert derivative.processing_state != DerivativeProcessingState.FAILED, job.error_code
                if job.state == "done":
                    assert derivative.processing_state == DerivativeProcessingState.READY
                    assert derivative.review_state == DerivativeReviewState.PENDING
                    assert (derivative.width, derivative.height) == ((360, 640) if rotate else (640, 360))
                    video = storage.get(derivative.object.object_key)
                    assert video.index(b"moov") < video.index(b"mdat")
                    assert b"12.345" not in video and b"67.890" not in video and b"gpmd" not in video
                    return
            time.sleep(0.1)
        pytest.fail("worker did not finish within parity test deadline")
    finally:
        client.close()
