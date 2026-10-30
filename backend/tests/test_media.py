import io
import subprocess
import time
from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import current_subject
from app.config import settings
from app.database import Base, get_session
from app.main import app
from app.media import oauth
from app.media.providers import (
    ProviderError,
    ProviderMediaItem,
    ProviderSession,
    ProviderSessionStatus,
    get_provider_resolver,
)
from app.media.service import delete_media_asset, delete_media_derivative, direct_upload, purge_deleted_media
from app.models import ImportProvider, ImportSession, MediaAsset, ObjectState, StoredObject
from app.secrets import Credential, InMemorySecretStore, get_secret_store
from app.storage import LocalObjectStorage, get_storage

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


@pytest.fixture(autouse=True)
def configured_google(monkeypatch) -> None:
    monkeypatch.setattr(settings, "google_oauth_client_id", "test-client")
    monkeypatch.setattr(settings, "google_oauth_client_secret", "test-secret")
    monkeypatch.setattr(settings, "google_oauth_redirect_uri", "http://localhost:5173/admin/settings")
    monkeypatch.setattr(settings, "provider_secret_key", "test-key")


def override_session() -> Generator[Session]:
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


def client_for(subject: str, tmp_path: Path, secret_store: InMemorySecretStore | None = None) -> TestClient:
    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[current_subject] = lambda: subject
    app.dependency_overrides[get_storage] = lambda: LocalObjectStorage(root=str(tmp_path))
    app.dependency_overrides[get_secret_store] = lambda: (
        secret_store if secret_store is not None else InMemorySecretStore()
    )
    return TestClient(app)


def setup_function() -> None:
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


def teardown_function() -> None:
    app.dependency_overrides.clear()


def create_trip(client: TestClient, title: str = "Exampleland 2054") -> dict:
    response = client.post("/api/trips", json={"title": title, "summary": "A private trip."})
    assert response.status_code == 201, response.text
    return response.json()


def jpeg_bytes(
    color: tuple[int, int, int] = (200, 120, 40),
    with_exif: bool = True,
    with_gps: bool = False,
    captured_at: str | None = None,
    offset: str | None = None,
) -> bytes:
    image = Image.new("RGB", (40, 30), color)
    buffer = io.BytesIO()
    if with_exif:
        exif = image.getexif()
        exif[271] = "ExampleCam"  # Make
        exif[272] = "ExampleModel"  # Model
        if captured_at:
            # DateTimeOriginal, "YYYY:MM:DD HH:MM:SS", in the Exif sub-IFD where cameras write it.
            exif.get_ifd(0x8769)[36867] = captured_at
            if offset:
                exif.get_ifd(0x8769)[36881] = offset  # OffsetTimeOriginal
        if with_gps:
            gps = exif.get_ifd(0x8825)
            gps[1] = "N"
            gps[2] = (25.0, 3.0, 12.5)  # GPSLatitude (DMS)
            gps[3] = "E"
            gps[4] = (121.0, 30.0, 0.0)  # GPSLongitude (DMS)
        image.save(buffer, format="JPEG", exif=exif)
    else:
        image.save(buffer, format="JPEG")
    return buffer.getvalue()


def video_with_telemetry(tmp_path: Path) -> bytes:
    telemetry = tmp_path / "telemetry.bin"
    telemetry.write_bytes(b"GPS 12.345,67.890")
    source = tmp_path / "source.mov"
    subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=640x360:rate=10:duration=3",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=3",
            "-f",
            "data",
            "-i",
            str(telemetry),
            "-map",
            "0:v",
            "-map",
            "1:a",
            "-map",
            "2:d",
            "-c:v",
            "mpeg4",
            "-c:a",
            "aac",
            "-c:d",
            "copy",
            "-tag:d",
            "gpmd",
            "-metadata",
            "location=+12.345+067.890/",
            "-metadata:s:v:0",
            "comment=GPS 12.345,67.890",
            "-y",
            str(source),
        ],
        check=True,
        capture_output=True,
    )
    return source.read_bytes()


def test_video_job_left_processing_by_the_retired_local_encoder_becomes_retryable(tmp_path: Path) -> None:
    from app.media import service
    from app.models import DerivativePurpose, MediaDerivative

    client = client_for("owner-1", tmp_path)
    trip = create_trip(client)
    with TestingSessionLocal() as session:
        asset, _ = direct_upload(
            session,
            LocalObjectStorage(root=str(tmp_path)),
            trip_id=trip["id"],
            filename="clip.mov",
            content_type="video/quicktime",
            data=video_with_telemetry(tmp_path),
        )
        derivative = service.queue_video_derivative(
            session, media_asset=asset, purpose=DerivativePurpose.SHARE, remove_audio=False
        )
        derivative_id, asset_id = derivative.id, asset.id
        derivative.processing_backend = "local"
        derivative.processing_started_at = datetime.now(UTC) - timedelta(
            seconds=service.VIDEO_STALLED_AFTER_SECONDS + 1
        )
        session.commit()
    path = f"/api/trips/{trip['id']}/media/{asset_id}/derivatives"
    assert client.get(path).json()[0]["processing_state"] == "failed"
    with TestingSessionLocal() as session:
        assert session.get(MediaDerivative, derivative_id).object_id is None


def _queue_video(session: Session, tmp_path: Path, trip_id: str, *, filename: str = "clip.mov"):
    from app.media import service
    from app.models import DerivativePurpose

    asset, _ = direct_upload(
        session,
        LocalObjectStorage(root=str(tmp_path)),
        trip_id=trip_id,
        filename=filename,
        content_type="video/quicktime",
        data=video_with_telemetry(tmp_path),
    )
    return service.queue_video_derivative(
        session, media_asset=asset, purpose=DerivativePurpose.SHARE, remove_audio=False
    )


# --- Fake providers: no test ever makes a real network call -----------------------


class FakeProvider:
    def __init__(
        self,
        provider: ImportProvider,
        items: list[ProviderMediaItem],
        contents: dict[str, bytes],
        picker_uri: str = "https://photos.google.com/picker/session/fake-abc123",
        ready: bool = True,
        fail_once: set[str] | None = None,
    ) -> None:
        self.provider = provider
        self._items = items
        self._contents = contents
        self.picker_uri = picker_uri
        self.ready = ready
        self._fail_once = set(fail_once or ())
        self.fetch_calls: dict[str, int] = {}

    def create_session(self, *, access_token: str) -> ProviderSession:
        return ProviderSession(provider_session_id="picker-session-1", picker_uri=self.picker_uri, expires_at=None)

    def poll_session(self, *, access_token: str, provider_session_id: str) -> ProviderSessionStatus:
        return ProviderSessionStatus(ready=self.ready)

    def list_selected_items(self, *, access_token: str, provider_session_id: str) -> list[ProviderMediaItem]:
        return list(self._items)

    def fetch_item(self, *, access_token: str, item: ProviderMediaItem) -> bytes:
        self.fetch_calls[item.provider_item_id] = self.fetch_calls.get(item.provider_item_id, 0) + 1
        if item.provider_item_id in self._fail_once:
            self._fail_once.discard(item.provider_item_id)
            raise ProviderError("simulated transient failure fetching the item")
        return self._contents[item.provider_item_id]


def use_fake_provider(fake: FakeProvider) -> None:
    app.dependency_overrides[get_provider_resolver] = lambda: lambda provider: fake


# --- Direct device upload: the durable fallback ------------------------------------


def test_direct_upload_creates_a_media_asset_served_from_storage_not_a_temp_url(tmp_path: Path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    data = jpeg_bytes()

    response = owner.post(f"/api/trips/{trip['id']}/media/uploads", files={"file": ("holiday.jpg", data, "image/jpeg")})
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["content_type"] == "image/jpeg"
    assert body["byte_size"] == len(data)
    assert body["original_filename"] == "holiday.jpg"
    assert body["file_url"] == f"/api/trips/{trip['id']}/media/{body['id']}/original"
    assert "object_key" not in body
    assert "bucket" not in body

    original = owner.get(body["file_url"])
    assert original.status_code == 200
    assert original.content == data
    assert original.headers["cache-control"] == "no-store"

    other = client_for("owner-2", tmp_path)
    assert other.get(f"/api/trips/{trip['id']}/media").status_code == 404
    assert other.get(body["file_url"]).status_code == 404


def test_photo_thumbnail_is_a_smaller_owner_only_image(tmp_path: Path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    data = jpeg_bytes()

    response = owner.post(f"/api/trips/{trip['id']}/media/uploads", files={"file": ("holiday.jpg", data, "image/jpeg")})
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["thumbnail_url"] == f"/api/trips/{trip['id']}/media/{body['id']}/thumbnail"

    thumbnail = owner.get(body["thumbnail_url"])
    assert thumbnail.status_code == 200
    assert thumbnail.headers["content-type"] == "image/webp"
    assert thumbnail.headers["cache-control"] == "private, max-age=300"
    assert len(thumbnail.content) < len(data)
    with Image.open(io.BytesIO(thumbnail.content)) as image:
        assert max(image.size) <= 320

    other = client_for("owner-2", tmp_path)
    assert other.get(body["thumbnail_url"]).status_code == 404


def test_thumbnail_cache_reuses_bytes_and_is_purged_with_original(tmp_path: Path, monkeypatch) -> None:
    from app.media import service

    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    media = owner.post(
        f"/api/trips/{trip['id']}/media/uploads",
        files={"file": ("photo.jpg", jpeg_bytes(), "image/jpeg")},
    ).json()
    first = owner.get(media["thumbnail_url"])
    assert first.status_code == 200

    def no_decode(*args, **kwargs):
        raise AssertionError("cached thumbnail must not decode the original")

    monkeypatch.setattr(service, "generate_thumbnail", no_decode)
    assert owner.get(media["thumbnail_url"]).content == first.content
    headers = {"If-None-Match": first.headers["etag"]}
    validated = owner.get(media["thumbnail_url"], headers=headers)
    assert validated.status_code == 304
    assert validated.content == b""
    assert client_for("owner-2", tmp_path).get(media["thumbnail_url"], headers=headers).status_code == 404
    owner = client_for("owner-1", tmp_path)
    assert owner.get(f"/api/trips/{trip['id']}/media/{media['id']}/derivatives").json() == []
    assert owner.delete(f"/api/trips/{trip['id']}/media/{media['id']}").status_code == 204
    assert owner.get(media["thumbnail_url"], headers=headers).status_code == 404
    with TestingSessionLocal() as session:
        storage = LocalObjectStorage(root=str(tmp_path))
        assert service.purge_deleted_media(session, storage, older_than=timedelta(0)) == 2
        assert list(storage.objects()) == []


def test_video_asset_has_no_thumbnail(tmp_path: Path) -> None:
    storage = LocalObjectStorage(root=str(tmp_path))
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    with TestingSessionLocal() as session:
        asset, _ = direct_upload(
            session,
            storage,
            trip_id=trip["id"],
            filename="clip.mov",
            content_type="video/quicktime",
            data=b"not-a-real-video",
        )
        asset_id = asset.id

    listing = owner.get(f"/api/trips/{trip['id']}/media")
    assert listing.status_code == 200
    [item] = [entry for entry in listing.json() if entry["id"] == asset_id]
    assert item["thumbnail_url"] is None
    assert owner.get(f"/api/trips/{trip['id']}/media/{asset_id}/thumbnail").status_code == 404


def test_direct_upload_extracts_exif_for_the_owner_while_the_original_keeps_it_embedded(tmp_path: Path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    data = jpeg_bytes(with_gps=True, captured_at="2054:04:01 08:30:00")

    response = owner.post(f"/api/trips/{trip['id']}/media/uploads", files={"file": ("sunrise.jpg", data, "image/jpeg")})
    assert response.status_code == 201, response.text
    body = response.json()

    # The owner gets a parsed convenience subset for pre-filling a reisupdate...
    assert body["captured_at"].startswith("2054-04-01T08:30:00")
    assert body["camera_make"] == "ExampleCam"
    assert body["camera_model"] == "ExampleModel"
    assert body["gps"]["latitude"] == pytest.approx(25.053472, abs=1e-4)
    assert body["gps"]["longitude"] == pytest.approx(121.5, abs=1e-4)

    # ...while the original file itself is stored byte-for-byte, EXIF intact
    # (only a share derivative ever strips it, never the original).
    original = owner.get(body["file_url"])
    assert original.content == data
    assert Image.open(io.BytesIO(original.content)).getexif().get(271) == "ExampleCam"


def test_exif_capture_time_is_camera_wall_time_whatever_the_server_zone(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The server runs in a zone other than the photo's (Exampleland); the wall time must come back unchanged.
    monkeypatch.setenv("TZ", "America/New_York")
    time.tzset()
    try:
        owner = client_for("owner-1", tmp_path)
        trip = create_trip(owner)
        data = jpeg_bytes(captured_at="2054:11:20 10:15:00")

        body = owner.post(
            f"/api/trips/{trip['id']}/media/uploads", files={"file": ("taipei.jpg", data, "image/jpeg")}
        ).json()
        assert body["captured_local"] is True
        assert body["captured_at"].startswith("2054-11-20T10:15:00")
    finally:
        monkeypatch.undo()
        time.tzset()


def test_exif_wall_time_keeps_its_written_clock_when_the_camera_records_an_offset(tmp_path: Path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    data = jpeg_bytes(captured_at="2054:11:20 10:15:00", offset="+08:00")

    body = owner.post(
        f"/api/trips/{trip['id']}/media/uploads", files={"file": ("taipei.jpg", data, "image/jpeg")}
    ).json()

    assert body["captured_local"] is True
    assert body["captured_at"].startswith("2054-11-20T10:15:00")


def test_candidate_grouping_uses_recorded_offsets_and_never_the_viewer_zone(tmp_path: Path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)

    def upload(name: str, colour: tuple[int, int, int], taken: str, offset: str) -> dict:
        return owner.post(
            f"/api/trips/{trip['id']}/media/uploads",
            files={"file": (name, jpeg_bytes(colour, captured_at=taken, offset=offset), "image/jpeg")},
        ).json()

    # 10:15 +08:00 and 04:30 +02:00 are 15 minutes apart in real time, though 5½ hours apart on the clock.
    taipei = upload("taipei.jpg", (1, 1, 1), "2054:11:20 10:15:00", "+08:00")
    brussels = upload("brussels.jpg", (2, 2, 2), "2054:11:20 04:30:00", "+02:00")
    # The same wall time, but eight hours later in real time, is a separate candidate.
    evening = upload("evening.jpg", (3, 3, 3), "2054:11:20 18:15:00", "+08:00")

    body = owner.post(
        f"/api/trips/{trip['id']}/media/travel-update-candidates",
        json={"media_asset_ids": [taipei["id"], brussels["id"], evening["id"]]},
    ).json()

    assert len(body["candidates"]) == 2
    first, second = body["candidates"]
    assert set(first["media_asset_ids"]) == {taipei["id"], brussels["id"]}
    assert second["media_asset_ids"] == [evening["id"]]
    assert second["captured_local"] is True
    assert second["starts_at"].startswith("2054-11-20T18:15:00")
    assert {option["captured_at"][:19] for option in first["time_options"]} == {
        "2054-11-20T10:15:00",
        "2054-11-20T04:30:00",
    }
    assert all(option["captured_local"] for option in first["time_options"])


def test_direct_upload_is_idempotent_and_never_duplicates_a_media_record(tmp_path: Path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    data = jpeg_bytes()

    first = owner.post(f"/api/trips/{trip['id']}/media/uploads", files={"file": ("a.jpg", data, "image/jpeg")})
    assert first.status_code == 201
    second = owner.post(f"/api/trips/{trip['id']}/media/uploads", files={"file": ("b.jpg", data, "image/jpeg")})
    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]

    listed = owner.get(f"/api/trips/{trip['id']}/media")
    assert len(listed.json()) == 1


def test_upload_over_the_configured_size_limit_is_rejected(tmp_path: Path, monkeypatch) -> None:
    from app.config import settings

    monkeypatch.setattr(settings, "media_max_upload_bytes", 10)
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)

    response = owner.post(
        f"/api/trips/{trip['id']}/media/uploads", files={"file": ("big.jpg", jpeg_bytes(), "image/jpeg")}
    )
    assert response.status_code == 422


def test_deleting_media_removes_it_from_owner_queries_immediately(tmp_path: Path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    uploaded = owner.post(
        f"/api/trips/{trip['id']}/media/uploads", files={"file": ("a.jpg", jpeg_bytes(), "image/jpeg")}
    ).json()

    assert owner.delete(f"/api/trips/{trip['id']}/media/{uploaded['id']}").status_code == 204
    assert owner.get(f"/api/trips/{trip['id']}/media/{uploaded['id']}").status_code == 404
    assert owner.get(f"/api/trips/{trip['id']}/media").json() == []


# --- Travel update candidates: transient owner review, never canonical data ------


def test_owner_can_review_selected_media_as_travel_updates_without_creating_updates_or_places(
    tmp_path: Path,
) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)

    first = owner.post(
        f"/api/trips/{trip['id']}/media/uploads",
        files={
            "file": ("first.jpg", jpeg_bytes((1, 2, 3), with_gps=True, captured_at="2054:04:01 08:00:00"), "image/jpeg")
        },
    ).json()
    second = owner.post(
        f"/api/trips/{trip['id']}/media/uploads",
        files={
            "file": (
                "second.jpg",
                jpeg_bytes((4, 5, 6), with_gps=True, captured_at="2054:04:01 09:00:00"),
                "image/jpeg",
            )
        },
    ).json()
    later = owner.post(
        f"/api/trips/{trip['id']}/media/uploads",
        files={
            "file": ("later.jpg", jpeg_bytes((7, 8, 9), with_gps=True, captured_at="2054:04:01 10:01:00"), "image/jpeg")
        },
    ).json()
    unavailable = owner.post(
        f"/api/trips/{trip['id']}/media/uploads",
        files={"file": ("no-metadata.jpg", jpeg_bytes((10, 11, 12), with_exif=False), "image/jpeg")},
    ).json()

    # Keep a materially different GPS reading separate instead of silently
    # averaging it into the first photo's position.
    with TestingSessionLocal() as session:
        asset = session.get(MediaAsset, second["id"])
        assert asset is not None
        asset.raw_metadata = {"exif": {"gps": {"latitude": 26.0, "longitude": 121.5}}}
        session.commit()

    reviewed = owner.post(
        f"/api/trips/{trip['id']}/media/travel-update-candidates",
        json={"media_asset_ids": [first["id"], second["id"], later["id"], unavailable["id"]]},
    )
    assert reviewed.status_code == 200, reviewed.text
    body = reviewed.json()
    assert body["grouping_window_minutes"] == 120
    assert body["gps_agreement_metres"] == 500
    assert body["unavailable_media_asset_ids"] == [unavailable["id"]]
    assert len(body["candidates"]) == 2  # 10:01 is outside the 08:00-10:00 window.
    first_candidate = body["candidates"][0]
    assert first_candidate["media_asset_ids"] == [first["id"], second["id"]]
    assert [option["media_asset_id"] for option in first_candidate["time_options"]] == [first["id"], second["id"]]
    assert len(first_candidate["location_options"]) == 2
    assert first_candidate["location_options"][0]["latitude"] == pytest.approx(25.053472)
    assert first_candidate["location_options"][1]["latitude"] == 26.0

    # Candidate generation is a read-only review operation: it cannot create
    # a reisupdate, place, shareable item, or persistent candidate row.
    trip_after_review = owner.get(f"/api/trips/{trip['id']}").json()
    assert trip_after_review["travel_updates"] == []
    assert owner.get(f"/api/trips/{trip['id']}/locations").json() == []

    other = client_for("owner-2", tmp_path)
    assert (
        other.post(
            f"/api/trips/{trip['id']}/media/travel-update-candidates", json={"media_asset_ids": [first["id"]]}
        ).status_code
        == 404
    )


# --- Share derivatives: stripped and resized, gated on owner review ---------------


def test_share_derivative_strips_exif_and_starts_pending_owner_review(tmp_path: Path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    original_bytes = jpeg_bytes()
    assert Image.open(io.BytesIO(original_bytes)).getexif().get(271) == "ExampleCam"

    media = owner.post(
        f"/api/trips/{trip['id']}/media/uploads", files={"file": ("a.jpg", original_bytes, "image/jpeg")}
    ).json()

    created = owner.post(
        f"/api/trips/{trip['id']}/media/{media['id']}/derivatives",
        json={"purpose": "share", "max_dimension": 800},
    )
    assert created.status_code == 201, created.text
    derivative = created.json()
    assert derivative["review_state"] == "pending"
    assert derivative["metadata_stripped_at"] is not None
    assert "object_key" not in derivative

    file_response = owner.get(derivative["file_url"])
    assert file_response.status_code == 200
    stripped_image = Image.open(io.BytesIO(file_response.content))
    assert stripped_image.format == "WEBP"
    assert not stripped_image.getexif()  # no Make/Model/GPS tag survives

    approved = owner.post(f"/api/trips/{trip['id']}/media/{media['id']}/derivatives/{derivative['id']}/approve")
    assert approved.status_code == 200
    assert approved.json()["review_state"] == "approved"


def test_deleting_a_derivative_withdraws_it_from_every_live_share_scope(tmp_path: Path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    media = owner.post(
        f"/api/trips/{trip['id']}/media/uploads", files={"file": ("a.jpg", jpeg_bytes(), "image/jpeg")}
    ).json()
    derivative = owner.post(
        f"/api/trips/{trip['id']}/media/{media['id']}/derivatives", json={"purpose": "share"}
    ).json()
    assert (
        owner.post(f"/api/trips/{trip['id']}/media/{media['id']}/derivatives/{derivative['id']}/approve").status_code
        == 200
    )

    assert (
        owner.put(
            f"/api/trips/{trip['id']}/visibility/media_derivative/{derivative['id']}", json={"visibility": "custom"}
        ).status_code
        == 200
    )
    scope = {
        "schema_version": "travel/share-scope@1",
        "trip": {"title": True, "summary": True},
        "items": [{"kind": "media_derivative", "id": derivative["id"]}],
    }
    assert owner.put(f"/api/trips/{trip['id']}/public-projection", json=scope).status_code == 200
    link = owner.post(f"/api/trips/{trip['id']}/share-links", json={"label": "Gallery", "scope": scope})
    assert link.status_code == 201, link.text

    deleted = owner.delete(f"/api/trips/{trip['id']}/media/{media['id']}/derivatives/{derivative['id']}")
    assert deleted.status_code == 204
    owner = client_for("owner-1", tmp_path)
    assert owner.get(f"/api/trips/{trip['id']}/media/{media['id']}/derivatives").json() == []
    assert owner.get(derivative["file_url"]).status_code == 404
    assert owner.get(f"/api/trips/{trip['id']}/public-projection").json()["scope"]["items"] == []
    assert owner.get(f"/api/trips/{trip['id']}/share-links/{link.json()['id']}").json()["scope"]["items"] == []


def test_provider_status_is_owner_only_and_never_returns_a_token(tmp_path: Path) -> None:
    secret_store = InMemorySecretStore()
    owner = client_for("owner-1", tmp_path, secret_store=secret_store)
    assert (
        owner.put("/api/provider-tokens/google_photos_picker", json={"access_token": "never-return-this"}).status_code
        == 204
    )

    statuses = owner.get("/api/provider-tokens")
    assert statuses.status_code == 200
    assert statuses.json() == [
        {"provider": "google_photos_picker", "available": True, "connected": True},
        {"provider": "gopro_cloud", "available": False, "connected": False},
    ]
    assert "never-return-this" not in statuses.text
    assert owner.delete("/api/provider-tokens/google_photos_picker").status_code == 204
    assert owner.get("/api/provider-tokens").json()[0] == {
        "provider": "google_photos_picker",
        "available": True,
        "connected": False,
    }


def test_provider_availability_requires_oauth_configuration(tmp_path: Path, monkeypatch) -> None:
    from app.config import settings

    owner = client_for("owner-1", tmp_path)
    assert {row["provider"]: row["available"] for row in owner.get("/api/provider-tokens").json()} == {
        "google_photos_picker": True,
        "gopro_cloud": False,
    }
    monkeypatch.setattr(settings, "google_oauth_client_secret", None)
    assert {row["provider"]: row["available"] for row in owner.get("/api/provider-tokens").json()} == {
        "google_photos_picker": False,
        "gopro_cloud": False,
    }
    assert owner.put("/api/provider-tokens/google_photos_picker", json={"access_token": "token"}).status_code == 409
    assert owner.post("/api/provider-tokens/google_photos_picker/oauth/start").status_code == 409
    assert (
        owner.post(
            "/api/provider-tokens/google_photos_picker/oauth/complete", json={"code": "code", "state": "state"}
        ).status_code
        == 409
    )
    trip = create_trip(owner)
    assert owner.post(f"/api/trips/{trip['id']}/media/imports/google_photos_picker/sessions").status_code == 409


# --- Google Photos Picker import: only explicitly selected items ------------------


def google_items() -> tuple[list[ProviderMediaItem], dict[str, bytes]]:
    items = [
        ProviderMediaItem(
            provider_item_id="g-item-1",
            filename="sunrise.jpg",
            content_type="image/jpeg",
            captured_at=datetime(2054, 4, 1, tzinfo=UTC),
        ),
        ProviderMediaItem(
            provider_item_id="g-item-2",
            filename="lake.jpg",
            content_type="image/jpeg",
            captured_at=datetime(2054, 4, 2, tzinfo=UTC),
        ),
    ]
    contents = {"g-item-1": jpeg_bytes((10, 20, 30)), "g-item-2": jpeg_bytes((40, 50, 60))}
    return items, contents


def test_google_photos_picker_import_copies_selected_items_into_travel_storage(tmp_path: Path) -> None:
    secret_store = InMemorySecretStore()
    owner = client_for("owner-1", tmp_path, secret_store=secret_store)
    trip = create_trip(owner)

    assert (
        owner.put("/api/provider-tokens/google_photos_picker", json={"access_token": "owner-google-token"}).status_code
        == 204
    )

    items, contents = google_items()
    fake = FakeProvider(ImportProvider.GOOGLE_PHOTOS_PICKER, items, contents)
    use_fake_provider(fake)

    started = owner.post(f"/api/trips/{trip['id']}/media/imports/google_photos_picker/sessions")
    assert started.status_code == 200, started.text
    session_body = started.json()
    assert session_body["picker_uri"] == fake.picker_uri

    completed = owner.post(
        f"/api/trips/{trip['id']}/media/imports/google_photos_picker/sessions/{session_body['id']}/complete"
    )
    assert completed.status_code == 200, completed.text
    outcome = completed.json()
    assert outcome["ready"] is True
    assert len(outcome["imported"]) == 2
    assert outcome["failed"] == []
    assert outcome["imported"][0]["camera_make"] == "ExampleCam"

    body_text = completed.text
    assert fake.picker_uri not in body_text
    assert "owner-google-token" not in body_text

    listed = owner.get(f"/api/trips/{trip['id']}/media").json()
    assert len(listed) == 2
    for asset in listed:
        stored = owner.get(asset["file_url"])
        assert stored.status_code == 200
        assert stored.content in contents.values()


def test_google_import_refreshes_between_start_and_complete(tmp_path: Path, monkeypatch) -> None:
    store = InMemorySecretStore()
    owner = client_for("owner-1", tmp_path, secret_store=store)
    trip = create_trip(owner)
    expired = (datetime.now(UTC) - timedelta(minutes=1)).isoformat()
    store.set_credential(subject="owner-1", provider=oauth.GOOGLE, credential=Credential("stale", "refresh", expired))
    tokens = []

    class TokenCheckingProvider(FakeProvider):
        def create_session(self, *, access_token: str) -> ProviderSession:
            tokens.append(access_token)
            return super().create_session(access_token=access_token)

        def poll_session(self, *, access_token: str, provider_session_id: str) -> ProviderSessionStatus:
            tokens.append(access_token)
            return super().poll_session(access_token=access_token, provider_session_id=provider_session_id)

        def fetch_item(self, *, access_token: str, item: ProviderMediaItem) -> bytes:
            tokens.append(access_token)
            return super().fetch_item(access_token=access_token, item=item)

    items, contents = google_items()
    use_fake_provider(TokenCheckingProvider(ImportProvider.GOOGLE_PHOTOS_PICKER, items, contents))
    grants = []

    def refreshed(_data):
        grants.append(True)
        return {"access_token": f"fresh-{len(grants)}", "expires_in": 3600}

    monkeypatch.setattr(oauth, "_post_token", refreshed)
    started = owner.post(f"/api/trips/{trip['id']}/media/imports/google_photos_picker/sessions")
    assert started.status_code == 200
    store.set_credential(subject="owner-1", provider=oauth.GOOGLE, credential=Credential("fresh-1", "refresh", expired))
    completed = owner.post(
        f"/api/trips/{trip['id']}/media/imports/google_photos_picker/sessions/{started.json()['id']}/complete"
    )
    assert completed.status_code == 200
    assert len(completed.json()["imported"]) == 2
    assert tokens == ["fresh-1", "fresh-2", "fresh-2", "fresh-2"]
    assert len(grants) == 2


def test_imported_exif_capture_time_takes_precedence_over_the_providers_own_metadata(tmp_path: Path) -> None:
    secret_store = InMemorySecretStore()
    owner = client_for("owner-1", tmp_path, secret_store=secret_store)
    trip = create_trip(owner)
    owner.put("/api/provider-tokens/google_photos_picker", json={"access_token": "token-1"})

    # The provider (e.g. Google's createTime) says 2054-04-02, but the
    # camera's own EXIF DateTimeOriginal says 2054-04-01: the actual capture
    # instant from the file itself should win.
    item = ProviderMediaItem(
        provider_item_id="g-item-1",
        filename="sunrise.jpg",
        content_type="image/jpeg",
        captured_at=datetime(2054, 4, 2, tzinfo=UTC),
    )
    contents = {"g-item-1": jpeg_bytes(captured_at="2054:04:01 08:30:00")}
    use_fake_provider(FakeProvider(ImportProvider.GOOGLE_PHOTOS_PICKER, [item], contents))

    session_body = owner.post(f"/api/trips/{trip['id']}/media/imports/google_photos_picker/sessions").json()
    completed = owner.post(
        f"/api/trips/{trip['id']}/media/imports/google_photos_picker/sessions/{session_body['id']}/complete"
    ).json()

    assert completed["imported"][0]["captured_at"].startswith("2054-04-01T08:30:00")
    assert completed["imported"][0]["captured_local"] is True


def test_completing_an_expired_import_session_is_rejected_and_marks_it_expired(tmp_path: Path) -> None:
    secret_store = InMemorySecretStore()
    owner = client_for("owner-1", tmp_path, secret_store=secret_store)
    trip = create_trip(owner)
    owner.put("/api/provider-tokens/google_photos_picker", json={"access_token": "token-1"})

    items, contents = google_items()
    use_fake_provider(FakeProvider(ImportProvider.GOOGLE_PHOTOS_PICKER, items, contents))
    session_body = owner.post(f"/api/trips/{trip['id']}/media/imports/google_photos_picker/sessions").json()

    with TestingSessionLocal() as db:
        row = db.scalar(select(ImportSession).where(ImportSession.id == session_body["id"]))
        row.expires_at = datetime.now(UTC) - timedelta(minutes=1)
        db.commit()

    response = owner.post(
        f"/api/trips/{trip['id']}/media/imports/google_photos_picker/sessions/{session_body['id']}/complete"
    )
    assert response.status_code == 409

    with TestingSessionLocal() as db:
        row = db.scalar(select(ImportSession).where(ImportSession.id == session_body["id"]))
        assert row.state == "expired"

    # A second attempt against the now-expired session is rejected the same
    # way, without needing to re-check `expires_at`.
    again = owner.post(
        f"/api/trips/{trip['id']}/media/imports/google_photos_picker/sessions/{session_body['id']}/complete"
    )
    assert again.status_code == 409
    assert len(owner.get(f"/api/trips/{trip['id']}/media").json()) == 0


def test_import_is_rejected_without_a_connected_provider_token(tmp_path: Path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    items, contents = google_items()
    use_fake_provider(FakeProvider(ImportProvider.GOOGLE_PHOTOS_PICKER, items, contents))

    response = owner.post(f"/api/trips/{trip['id']}/media/imports/google_photos_picker/sessions")
    assert response.status_code == 409


def test_revoking_a_provider_token_blocks_new_imports_but_keeps_already_imported_media(tmp_path: Path) -> None:
    secret_store = InMemorySecretStore()
    owner = client_for("owner-1", tmp_path, secret_store=secret_store)
    trip = create_trip(owner)
    owner.put("/api/provider-tokens/google_photos_picker", json={"access_token": "token-1"})

    items, contents = google_items()
    use_fake_provider(FakeProvider(ImportProvider.GOOGLE_PHOTOS_PICKER, items, contents))
    session_body = owner.post(f"/api/trips/{trip['id']}/media/imports/google_photos_picker/sessions").json()
    owner.post(f"/api/trips/{trip['id']}/media/imports/google_photos_picker/sessions/{session_body['id']}/complete")
    assert len(owner.get(f"/api/trips/{trip['id']}/media").json()) == 2

    assert owner.delete("/api/provider-tokens/google_photos_picker").status_code == 204

    blocked = owner.post(f"/api/trips/{trip['id']}/media/imports/google_photos_picker/sessions")
    assert blocked.status_code == 409
    assert len(owner.get(f"/api/trips/{trip['id']}/media").json()) == 2


def test_an_interrupted_import_retry_only_reattempts_the_failed_item_and_never_duplicates(tmp_path: Path) -> None:
    secret_store = InMemorySecretStore()
    owner = client_for("owner-1", tmp_path, secret_store=secret_store)
    trip = create_trip(owner)
    owner.put("/api/provider-tokens/google_photos_picker", json={"access_token": "token-1"})

    items, contents = google_items()
    fake = FakeProvider(ImportProvider.GOOGLE_PHOTOS_PICKER, items, contents, fail_once={"g-item-2"})
    use_fake_provider(fake)

    session_body = owner.post(f"/api/trips/{trip['id']}/media/imports/google_photos_picker/sessions").json()
    complete_url = f"/api/trips/{trip['id']}/media/imports/google_photos_picker/sessions/{session_body['id']}/complete"

    first = owner.post(complete_url).json()
    assert len(first["imported"]) == 1
    assert [f["provider_item_id"] for f in first["failed"]] == ["g-item-2"]

    retry = owner.post(complete_url).json()
    assert retry["failed"] == []
    assert {asset["id"] for asset in retry["imported"]} | {a["id"] for a in first["imported"]}

    listed = owner.get(f"/api/trips/{trip['id']}/media").json()
    assert len(listed) == 2  # never duplicated the item that succeeded on the first pass
    assert fake.fetch_calls["g-item-1"] == 1
    assert fake.fetch_calls["g-item-2"] == 2


# --- GoPro Cloud: interface exists, but the product works fully without it --------


def test_gopro_cloud_import_is_unavailable_without_beta_access_while_direct_upload_still_works(tmp_path: Path) -> None:
    secret_store = InMemorySecretStore()
    owner = client_for("owner-1", tmp_path, secret_store=secret_store)
    trip = create_trip(owner)
    owner.put("/api/provider-tokens/gopro_cloud", json={"access_token": "gopro-token"})

    from app.config import settings

    assert settings.gopro_cloud_enabled is False
    response = owner.post(f"/api/trips/{trip['id']}/media/imports/gopro_cloud/sessions")
    assert response.status_code == 409

    upload = owner.post(f"/api/trips/{trip['id']}/media/uploads", files={"file": ("a.jpg", jpeg_bytes(), "image/jpeg")})
    assert upload.status_code == 201


# --- Deletion and purge (retention) -------------------------------------------------


def test_purge_deleted_media_keeps_a_recent_deletion_within_the_recovery_window(tmp_path: Path) -> None:
    storage = LocalObjectStorage(root=str(tmp_path))
    with TestingSessionLocal() as session:
        from app.models import Trip
        from app.routers.trips import trip_query

        trip = Trip(owner_subject="owner-1", title="Exampleland")
        session.add(trip)
        session.commit()
        asset, _ = direct_upload(
            session, storage, trip_id=trip.id, filename="a.jpg", content_type="image/jpeg", data=jpeg_bytes()
        )
        delete_media_asset(session, media_asset=asset)

        purged = purge_deleted_media(session, storage, older_than=timedelta(days=30))
        assert purged == 0
        remaining = session.get(MediaAsset, asset.id)
        assert remaining is not None
        assert remaining.deleted_at is not None
        assert session.scalar(trip_query().where(Trip.id == trip.id)) is not None


def test_purge_deleted_media_reclaims_original_and_derivative_objects_after_the_window(tmp_path: Path) -> None:
    from app.media.service import create_derivative
    from app.models import DerivativePurpose, Trip

    storage = LocalObjectStorage(root=str(tmp_path))
    with TestingSessionLocal() as session:
        trip = Trip(owner_subject="owner-1", title="Exampleland")
        session.add(trip)
        session.commit()
        asset, _ = direct_upload(
            session, storage, trip_id=trip.id, filename="a.jpg", content_type="image/jpeg", data=jpeg_bytes()
        )
        derivative = create_derivative(session, storage, media_asset=asset, purpose=DerivativePurpose.SHARE)
        original_key = asset.original_object.object_key
        derivative_key = derivative.object.object_key
        assert storage.exists(original_key)
        assert storage.exists(derivative_key)

        delete_media_asset(session, media_asset=asset)
        purged = purge_deleted_media(session, storage, older_than=timedelta(seconds=-1))
        assert purged == 2
        assert not storage.exists(original_key)
        assert not storage.exists(derivative_key)
        assert session.get(MediaAsset, asset.id) is None


def test_purge_deleted_media_retries_after_storage_failure_without_dangling_references(tmp_path: Path) -> None:
    from app.media.service import create_derivative
    from app.models import DerivativePurpose, Trip

    storage = LocalObjectStorage(root=str(tmp_path))
    with TestingSessionLocal() as session:
        trip = Trip(owner_subject="owner-1", title="Exampleland")
        session.add(trip)
        session.commit()
        asset, _ = direct_upload(
            session, storage, trip_id=trip.id, filename="a.jpg", content_type="image/jpeg", data=jpeg_bytes()
        )
        derivative = create_derivative(session, storage, media_asset=asset, purpose=DerivativePurpose.SHARE)
        object_keys = {asset.original_object.object_key, derivative.object.object_key}
        delete_media_asset(session, media_asset=asset)

        class FailingStorage(LocalObjectStorage):
            def __init__(self) -> None:
                super().__init__(root=str(tmp_path))
                self.deletions = 0

            def delete(self, key: str) -> None:
                self.deletions += 1
                if self.deletions == 2:
                    raise OSError("simulated storage failure")
                super().delete(key)

        with pytest.raises(OSError, match="simulated storage failure"):
            purge_deleted_media(session, FailingStorage(), older_than=timedelta(seconds=-1))
        session.rollback()

        assert session.get(MediaAsset, asset.id) is None
        pending = session.scalars(select(StoredObject).where(StoredObject.state == ObjectState.PURGE_PENDING)).all()
        assert len(pending) == 1
        assert pending[0].object_key in object_keys
        assert all(storage.exists(item.object_key) for item in pending)

        assert purge_deleted_media(session, storage, older_than=timedelta(seconds=-1)) == 1
        assert session.scalars(select(StoredObject).where(StoredObject.state == ObjectState.PURGE_PENDING)).all() == []
        assert all(not storage.exists(key) for key in object_keys)


def test_purge_deleted_media_keeps_a_shared_document_object(tmp_path: Path) -> None:
    from app.document.service import direct_upload as upload_document
    from app.models import DocumentKind, Trip

    storage = LocalObjectStorage(root=str(tmp_path))
    with TestingSessionLocal() as session:
        trip = Trip(owner_subject="owner-1", title="Exampleland")
        session.add(trip)
        session.commit()
        data = jpeg_bytes()
        asset, _ = direct_upload(
            session, storage, trip_id=trip.id, filename="a.jpg", content_type="image/jpeg", data=data
        )
        document, _ = upload_document(
            session,
            storage,
            trip_id=trip.id,
            filename="a.jpg",
            content_type="image/jpeg",
            data=data,
            document_kind=DocumentKind.OTHER,
            title="Receipt",
        )
        key = asset.original_object.object_key
        assert document.original_object_id == asset.original_object_id

        delete_media_asset(session, media_asset=asset)
        assert purge_deleted_media(session, storage, older_than=timedelta(seconds=-1)) == 0
        assert storage.exists(key)
        assert session.get(StoredObject, document.original_object_id).state == ObjectState.AVAILABLE


def test_purge_deleted_media_retries_when_commit_fails_after_file_deletion(tmp_path: Path, monkeypatch) -> None:
    from app.models import Trip

    storage = LocalObjectStorage(root=str(tmp_path))
    with TestingSessionLocal() as session:
        trip = Trip(owner_subject="owner-1", title="Exampleland")
        session.add(trip)
        session.commit()
        asset, _ = direct_upload(
            session, storage, trip_id=trip.id, filename="a.jpg", content_type="image/jpeg", data=jpeg_bytes()
        )
        object_id = asset.original_object_id
        key = asset.original_object.object_key
        delete_media_asset(session, media_asset=asset)

        commit = session.commit
        calls = 0

        def fail_second_commit() -> None:
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("simulated commit failure")
            commit()

        monkeypatch.setattr(session, "commit", fail_second_commit)
        with pytest.raises(OSError, match="simulated commit failure"):
            purge_deleted_media(session, storage, older_than=timedelta(seconds=-1))
        session.rollback()
        monkeypatch.setattr(session, "commit", commit)

        assert session.get(MediaAsset, asset.id) is None
        assert session.get(StoredObject, object_id).state == ObjectState.PURGE_PENDING
        assert not storage.exists(key)
        assert purge_deleted_media(session, storage, older_than=timedelta(seconds=-1)) == 1
        assert session.get(StoredObject, object_id) is None


def test_derivative_deletion_failure_leaves_retryable_object(tmp_path: Path) -> None:
    from app.media.service import create_derivative
    from app.models import DerivativePurpose, MediaDerivative, Trip

    storage = LocalObjectStorage(root=str(tmp_path))
    with TestingSessionLocal() as session:
        trip = Trip(owner_subject="owner-1", title="Exampleland")
        session.add(trip)
        session.commit()
        asset, _ = direct_upload(
            session, storage, trip_id=trip.id, filename="a.jpg", content_type="image/jpeg", data=jpeg_bytes()
        )
        derivative = create_derivative(session, storage, media_asset=asset, purpose=DerivativePurpose.SHARE)
        derivative_id = derivative.id
        object_id = derivative.object_id
        key = derivative.object.object_key

        class FailingStorage(LocalObjectStorage):
            def delete(self, _key: str) -> None:
                raise OSError("simulated storage failure")

        with pytest.raises(OSError, match="simulated storage failure"):
            delete_media_derivative(session, FailingStorage(root=str(tmp_path)), derivative=derivative)
        session.rollback()

        assert session.get(MediaDerivative, derivative_id) is None
        assert session.get(StoredObject, object_id).state == ObjectState.PURGE_PENDING
        assert storage.exists(key)
        assert purge_deleted_media(session, storage, older_than=timedelta(days=30)) == 1
        assert not storage.exists(key)


@pytest.mark.parametrize("case", ["heic", "svg", "truncated", "dimensions", "warning", "eps", "tiff"])
def test_invalid_images_are_rejected_before_storage(tmp_path: Path, case: str, monkeypatch) -> None:
    import struct

    owner = client_for("owner", tmp_path)
    trip = create_trip(owner)
    data = {
        "heic": b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00heicmif1",
        "svg": b'<svg xmlns="http://www.w3.org/2000/svg"/>',
        "truncated": jpeg_bytes()[:-20],
        "eps": b"%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 40 30\nshowpage\n",
    }.get(case, b"")
    if case == "tiff":
        buffer = io.BytesIO()
        Image.new("RGB", (2, 2)).save(buffer, format="TIFF")
        data = buffer.getvalue()
    if case == "dimensions":
        data = jpeg_bytes(with_exif=False)
        marker = data.index(b"\xff\xc0")
        data = data[: marker + 5] + struct.pack(">HH", 65535, 65535) + data[marker + 9 :]
    if case == "warning":
        monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 1000)
        data = jpeg_bytes()
    content_type = {"heic": "image/heic", "svg": "image/svg+xml"}.get(case, "image/jpeg")
    response = owner.post(f"/api/trips/{trip['id']}/media/uploads", files={"file": ("test.jpg", data, content_type)})
    assert response.status_code == 422, response.text
    assert response.json()["errors"][0]["code"] == "invalid_image"
    with TestingSessionLocal() as session:
        assert session.scalars(select(StoredObject)).all() == []
        assert session.scalars(select(MediaAsset)).all() == []
    assert not list(tmp_path.rglob("*"))


def test_photo_content_type_is_sniffed(tmp_path: Path) -> None:
    owner = client_for("owner", tmp_path)
    trip = create_trip(owner)
    response = owner.post(
        f"/api/trips/{trip['id']}/media/uploads",
        files={"file": ("wrong.png", jpeg_bytes(), "image/png")},
    )
    assert response.status_code == 201, response.text
    assert response.json()["content_type"] == "image/jpeg"


@pytest.mark.parametrize("operation", ["thumbnail", "derivative"])
def test_legacy_corrupt_photos_return_handled_errors(tmp_path: Path, operation: str) -> None:
    from app.media.service import MediaImportError, create_derivative, generate_thumbnail
    from app.models import DerivativePurpose

    owner = client_for("owner", tmp_path)
    trip = create_trip(owner)
    storage = LocalObjectStorage(root=str(tmp_path))
    with TestingSessionLocal() as session:
        asset, _ = direct_upload(
            session, storage, trip_id=trip["id"], filename="test.jpg", content_type="image/jpeg", data=jpeg_bytes()
        )
        # Simulate a legacy original without rewriting a referenced storage key.
        from unittest.mock import patch

        with patch.object(LocalObjectStorage, "get", return_value=b"not an image"):
            with pytest.raises(MediaImportError, match="Choose a valid") as error:
                if operation == "thumbnail":
                    generate_thumbnail(storage, media_asset=asset)
                else:
                    create_derivative(session, storage, media_asset=asset, purpose=DerivativePurpose.SHARE)
            assert error.value.code == "invalid_image"


def test_thumbnail_jpeg_uses_decoder_reduction() -> None:
    from app.media.service import _decoded_image

    buffer = io.BytesIO()
    Image.new("RGB", (4000, 3000)).save(buffer, format="JPEG")
    with _decoded_image(buffer.getvalue(), preview_size=320) as image:
        assert image.size == (500, 375)
