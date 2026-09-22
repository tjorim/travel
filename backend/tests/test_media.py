import io
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
from app.database import Base, get_session
from app.main import app
from app.media.providers import (
    ProviderError,
    ProviderMediaItem,
    ProviderSession,
    ProviderSessionStatus,
    get_provider_resolver,
)
from app.media.service import delete_media_asset, direct_upload, purge_deleted_media
from app.models import ImportProvider, ImportSession, MediaAsset
from app.secrets import InMemorySecretStore, get_secret_store
from app.storage import LocalObjectStorage, get_storage

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


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
    app.dependency_overrides[get_secret_store] = lambda: (secret_store if secret_store is not None else InMemorySecretStore())
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
) -> bytes:
    image = Image.new("RGB", (40, 30), color)
    buffer = io.BytesIO()
    if with_exif:
        exif = image.getexif()
        exif[271] = "ExampleCam"  # Make
        exif[272] = "ExampleModel"  # Model
        if captured_at:
            exif[36867] = captured_at  # DateTimeOriginal, "YYYY:MM:DD HH:MM:SS"
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
    app.dependency_overrides[get_provider_resolver] = lambda: (lambda provider: fake)


# --- Direct device upload: the durable fallback ------------------------------------


def test_direct_upload_creates_a_media_asset_served_from_storage_not_a_temp_url(tmp_path: Path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    data = jpeg_bytes()

    response = owner.post(
        f"/api/trips/{trip['id']}/media/uploads", files={"file": ("holiday.jpg", data, "image/jpeg")}
    )
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


def test_direct_upload_extracts_exif_for_the_owner_while_the_original_keeps_it_embedded(tmp_path: Path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    data = jpeg_bytes(with_gps=True, captured_at="2054:04:01 08:30:00")

    response = owner.post(
        f"/api/trips/{trip['id']}/media/uploads", files={"file": ("sunrise.jpg", data, "image/jpeg")}
    )
    assert response.status_code == 201, response.text
    body = response.json()

    # The owner gets a parsed convenience subset for pre-filling a moment...
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


# --- Visit candidates: transient owner review, never canonical data --------------


def test_owner_can_review_selected_media_as_visits_without_creating_moments_or_places(tmp_path: Path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)

    first = owner.post(
        f"/api/trips/{trip['id']}/media/uploads",
        files={"file": ("first.jpg", jpeg_bytes((1, 2, 3), with_gps=True, captured_at="2054:04:01 08:00:00"), "image/jpeg")},
    ).json()
    second = owner.post(
        f"/api/trips/{trip['id']}/media/uploads",
        files={"file": ("second.jpg", jpeg_bytes((4, 5, 6), with_gps=True, captured_at="2054:04:01 09:00:00"), "image/jpeg")},
    ).json()
    later = owner.post(
        f"/api/trips/{trip['id']}/media/uploads",
        files={"file": ("later.jpg", jpeg_bytes((7, 8, 9), with_gps=True, captured_at="2054:04:01 10:01:00"), "image/jpeg")},
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
        f"/api/trips/{trip['id']}/media/visit-candidates",
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
    # a moment, place, shareable item, or persistent candidate row.
    trip_after_review = owner.get(f"/api/trips/{trip['id']}").json()
    assert trip_after_review["moments"] == []
    assert owner.get(f"/api/trips/{trip['id']}/places").json() == []

    other = client_for("owner-2", tmp_path)
    assert other.post(
        f"/api/trips/{trip['id']}/media/visit-candidates", json={"media_asset_ids": [first["id"]]}
    ).status_code == 404


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

    approved = owner.post(
        f"/api/trips/{trip['id']}/media/{media['id']}/derivatives/{derivative['id']}/approve"
    )
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
    assert owner.post(
        f"/api/trips/{trip['id']}/media/{media['id']}/derivatives/{derivative['id']}/approve"
    ).status_code == 200

    scope = {
        "schema_version": "travel/share-scope@1",
        "trip": {"title": True, "summary": True},
        "items": [{"kind": "media_derivative", "id": derivative["id"], "fields": ["image"]}],
    }
    assert owner.put(f"/api/trips/{trip['id']}/public-projection", json=scope).status_code == 200
    link = owner.post(f"/api/trips/{trip['id']}/share-links", json={"label": "Gallery", "scope": scope})
    assert link.status_code == 201, link.text

    deleted = owner.delete(f"/api/trips/{trip['id']}/media/{media['id']}/derivatives/{derivative['id']}")
    assert deleted.status_code == 204
    assert owner.get(f"/api/trips/{trip['id']}/media/{media['id']}/derivatives").json() == []
    assert owner.get(derivative["file_url"]).status_code == 404
    assert owner.get(f"/api/trips/{trip['id']}/public-projection").json()["scope"]["items"] == []
    assert owner.get(f"/api/trips/{trip['id']}/share-links/{link.json()['id']}").json()["scope"]["items"] == []


def test_provider_status_is_owner_only_and_never_returns_a_token(tmp_path: Path) -> None:
    secret_store = InMemorySecretStore()
    owner = client_for("owner-1", tmp_path, secret_store=secret_store)
    assert owner.put("/api/provider-tokens/google_photos_picker", json={"access_token": "never-return-this"}).status_code == 204

    statuses = owner.get("/api/provider-tokens")
    assert statuses.status_code == 200
    assert statuses.json() == [
        {"provider": "google_photos_picker", "connected": True},
        {"provider": "gopro_cloud", "connected": False},
    ]
    assert "never-return-this" not in statuses.text
    assert owner.delete("/api/provider-tokens/google_photos_picker").status_code == 204
    assert owner.get("/api/provider-tokens").json()[0] == {"provider": "google_photos_picker", "connected": False}


# --- Google Photos Picker import: only explicitly selected items ------------------


def google_items() -> tuple[list[ProviderMediaItem], dict[str, bytes]]:
    items = [
        ProviderMediaItem(
            provider_item_id="g-item-1", filename="sunrise.jpg", content_type="image/jpeg", captured_at=datetime(2054, 4, 1, tzinfo=UTC)
        ),
        ProviderMediaItem(
            provider_item_id="g-item-2", filename="lake.jpg", content_type="image/jpeg", captured_at=datetime(2054, 4, 2, tzinfo=UTC)
        ),
    ]
    contents = {"g-item-1": jpeg_bytes((10, 20, 30)), "g-item-2": jpeg_bytes((40, 50, 60))}
    return items, contents


def test_google_photos_picker_import_copies_selected_items_into_travel_storage(tmp_path: Path) -> None:
    secret_store = InMemorySecretStore()
    owner = client_for("owner-1", tmp_path, secret_store=secret_store)
    trip = create_trip(owner)

    assert owner.put("/api/provider-tokens/google_photos_picker", json={"access_token": "owner-google-token"}).status_code == 204

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


def test_imported_exif_capture_time_takes_precedence_over_the_providers_own_metadata(tmp_path: Path) -> None:
    secret_store = InMemorySecretStore()
    owner = client_for("owner-1", tmp_path, secret_store=secret_store)
    trip = create_trip(owner)
    owner.put("/api/provider-tokens/google_photos_picker", json={"access_token": "token-1"})

    # The provider (e.g. Google's createTime) says 2054-04-02, but the
    # camera's own EXIF DateTimeOriginal says 2054-04-01: the actual capture
    # instant from the file itself should win.
    item = ProviderMediaItem(
        provider_item_id="g-item-1", filename="sunrise.jpg", content_type="image/jpeg", captured_at=datetime(2054, 4, 2, tzinfo=UTC)
    )
    contents = {"g-item-1": jpeg_bytes(captured_at="2054:04:01 08:30:00")}
    use_fake_provider(FakeProvider(ImportProvider.GOOGLE_PHOTOS_PICKER, [item], contents))

    session_body = owner.post(f"/api/trips/{trip['id']}/media/imports/google_photos_picker/sessions").json()
    completed = owner.post(
        f"/api/trips/{trip['id']}/media/imports/google_photos_picker/sessions/{session_body['id']}/complete"
    ).json()

    assert completed["imported"][0]["captured_at"].startswith("2054-04-01T08:30:00")


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

    upload = owner.post(
        f"/api/trips/{trip['id']}/media/uploads", files={"file": ("a.jpg", jpeg_bytes(), "image/jpeg")}
    )
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
        asset, _ = direct_upload(session, storage, trip_id=trip.id, filename="a.jpg", content_type="image/jpeg", data=jpeg_bytes())
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
        asset, _ = direct_upload(session, storage, trip_id=trip.id, filename="a.jpg", content_type="image/jpeg", data=jpeg_bytes())
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
