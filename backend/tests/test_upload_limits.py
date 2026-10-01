import io
from collections.abc import Generator
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import current_subject
from app.config import settings
from app.database import Base, get_session
from app.main import app
from app.media.providers import GooglePhotosPickerProvider, ProviderError, ProviderMediaItem
from app.media.service import MediaImportError, read_bounded_upload
from app.models import DocumentAsset, MediaAsset, OwnerDocument, OwnerStoredObject, StoredObject
from app.storage import LocalObjectStorage, get_storage

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
STORED_TABLES = (StoredObject, OwnerStoredObject, MediaAsset, DocumentAsset, OwnerDocument)


def override_session() -> Generator[Session]:
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


def client_for(subject: str, tmp_path: Path) -> TestClient:
    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[current_subject] = lambda: subject
    app.dependency_overrides[get_storage] = lambda: LocalObjectStorage(root=str(tmp_path))
    return TestClient(app)


def setup_function() -> None:
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


def teardown_function() -> None:
    app.dependency_overrides.clear()


def jpeg() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), "red").save(buffer, format="JPEG")
    return buffer.getvalue()


def stored_rows() -> int:
    with TestingSessionLocal() as session:
        return sum(session.scalar(select(func.count()).select_from(table)) for table in STORED_TABLES)


def upload(client: TestClient, route: str, trip_id: str, contents: bytes) -> httpx.Response:
    if route == "media":
        return client.post(f"/api/trips/{trip_id}/media/uploads", files={"file": ("a.jpg", contents, "image/jpeg")})
    url = f"/api/trips/{trip_id}/documents/uploads" if route == "documents" else "/api/library/documents/uploads"
    return client.post(
        url,
        data={"title": "Upload", "document_kind": "other"},
        files={"file": ("a.txt", contents, "text/plain")},
    )


def payload(route: str, size: int) -> bytes:
    if route != "media":
        return b"x" * size
    base = jpeg()
    assert size >= len(base)
    return base + b"\0" * (size - len(base))


ROUTES = ("documents", "library", "media")


@pytest.mark.parametrize("route", ROUTES)
def test_upload_exactly_at_the_limit_is_accepted(tmp_path: Path, monkeypatch, route: str) -> None:
    monkeypatch.setattr(settings, "media_max_upload_bytes", len(jpeg()) + 4)
    owner = client_for("owner-1", tmp_path)
    trip = owner.post("/api/trips", json={"title": "Exampleland 2054", "summary": "Private."}).json()

    response = upload(owner, route, trip["id"], payload(route, settings.media_max_upload_bytes))

    assert response.status_code == 201, response.text
    assert stored_rows() > 0


@pytest.mark.parametrize("route", ROUTES)
def test_upload_one_byte_over_the_limit_is_refused_and_stores_nothing(tmp_path: Path, monkeypatch, route: str) -> None:
    monkeypatch.setattr(settings, "media_max_upload_bytes", len(jpeg()) + 4)
    owner = client_for("owner-1", tmp_path)
    trip = owner.post("/api/trips", json={"title": "Exampleland 2054", "summary": "Private."}).json()

    response = upload(owner, route, trip["id"], payload(route, settings.media_max_upload_bytes + 1))

    assert response.status_code == 422
    assert "groter dan de toegestane" in response.json()["detail"]
    assert response.json()["errors"][0]["code"] == "file_too_large"
    assert stored_rows() == 0
    assert [path for path in tmp_path.rglob("*") if path.is_file()] == []


@pytest.mark.parametrize("route", ROUTES)
def test_empty_upload_is_refused_and_stores_nothing(tmp_path: Path, route: str) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = owner.post("/api/trips", json={"title": "Exampleland 2054", "summary": "Private."}).json()

    response = upload(owner, route, trip["id"], b"")

    assert response.status_code == 422
    assert response.json()["detail"] == "Het bestand is leeg."
    assert stored_rows() == 0
    assert [path for path in tmp_path.rglob("*") if path.is_file()] == []


class EndlessFile:
    """A source that would never end: reading it unbounded would exhaust memory."""

    def __init__(self) -> None:
        self.requested: list[int] = []
        self.served = 0

    def read(self, size: int = -1) -> bytes:
        assert size >= 0, "an unbounded read would buffer the whole upload"
        self.requested.append(size)
        self.served += size
        return b"x" * size


def test_reading_an_oversized_upload_never_holds_more_than_one_byte_past_the_limit(monkeypatch) -> None:
    monkeypatch.setattr(settings, "media_max_upload_bytes", 1024)
    source = EndlessFile()

    with pytest.raises(MediaImportError) as error:
        read_bounded_upload(source)

    assert error.value.code == "file_too_large"
    assert source.served == 1025
    assert max(source.requested) == 1025


def test_a_file_at_the_limit_is_returned_whole(monkeypatch) -> None:
    monkeypatch.setattr(settings, "media_max_upload_bytes", 4)

    assert read_bounded_upload(io.BytesIO(b"abcd")) == b"abcd"
    assert read_bounded_upload(io.BytesIO(b"")) == b""


def test_provider_downloads_stop_at_the_limit_without_reading_the_rest(monkeypatch) -> None:
    monkeypatch.setattr(settings, "media_max_upload_bytes", 10)
    produced = 0

    def body() -> Generator[bytes]:
        nonlocal produced
        while True:
            produced += 4
            yield b"xxxx"

    def reply(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/mediaItems/item-1"):
            return httpx.Response(200, json={"mediaFile": {"baseUrl": "https://lh3.example/file"}})
        return httpx.Response(200, content=body())

    provider = GooglePhotosPickerProvider(
        client=httpx.Client(base_url="https://provider.example", transport=httpx.MockTransport(reply))
    )
    item = ProviderMediaItem(provider_item_id="item-1", filename="a.jpg", content_type="image/jpeg", captured_at=None)

    with pytest.raises(ProviderError) as error:
        provider.fetch_item(access_token="token", item=item)

    assert error.value.code == "imported_item_exceeds_the_maximum_size"
    assert produced == 12


def test_provider_download_at_the_limit_is_returned(monkeypatch) -> None:
    monkeypatch.setattr(settings, "media_max_upload_bytes", 10)

    def reply(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/mediaItems/item-1"):
            return httpx.Response(200, json={"mediaFile": {"baseUrl": "https://lh3.example/file"}})
        return httpx.Response(200, content=b"0123456789")

    provider = GooglePhotosPickerProvider(
        client=httpx.Client(base_url="https://provider.example", transport=httpx.MockTransport(reply))
    )
    item = ProviderMediaItem(provider_item_id="item-1", filename="a.jpg", content_type="image/jpeg", captured_at=None)

    assert provider.fetch_item(access_token="token", item=item) == b"0123456789"
