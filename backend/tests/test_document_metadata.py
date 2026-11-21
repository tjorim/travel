import base64
from unittest.mock import Mock

import pytest
from pydantic import ValidationError

from app.main import app
from app.mcp import BinaryUpload, TravelMcpBackend
from app.mcp import core as mcp_core
from app.models import DocumentKind
from app.services.documents import ingest as documents
from app.services.storage import LocalObjectStorage, get_storage
from tests.routers.test_documents import TestingSessionLocal, client_for, create_trip, setup_function, teardown_function

__all__ = ["setup_function", "teardown_function"]


@pytest.mark.parametrize("title", ["", "x" * 161, "unsafe\x00title", "unsafe\ud800title"])
@pytest.mark.parametrize("kind", ["trip", "unfiled"])
@pytest.mark.parametrize("transport", ["http", "mcp", "service"])
def test_invalid_title_never_writes_storage(title, kind, transport, tmp_path, monkeypatch):
    client = client_for("owner-1", tmp_path)
    trip_id = create_trip(client)["id"]
    storage = Mock(wraps=LocalObjectStorage(root=str(tmp_path)))
    app.dependency_overrides[get_storage] = lambda: storage
    monkeypatch.setattr(mcp_core, "get_storage", lambda: storage)
    monkeypatch.setattr(mcp_core.settings, "mcp_development_subject", "owner-1")
    monkeypatch.setattr(mcp_core.settings, "environment", "development")
    data = f"synthetic-{kind}-{transport}-{ascii(title)}".encode()
    if transport == "http":
        if "\ud800" in title:
            pytest.skip("Surrogates cannot be encoded as HTTP multipart UTF-8")
        fields = {"title": title, "document_kind": "other"} | ({"trip_id": trip_id} if kind == "trip" else {})
        response = client.post(
            "/api/documents/uploads", data=fields, files={"file": ("sample.txt", data, "text/plain")}
        )
        assert response.status_code == 422
    elif transport == "mcp":
        backend = TravelMcpBackend(TestingSessionLocal)
        upload = BinaryUpload(
            filename="sample.txt", content_type="text/plain", data_base64=base64.b64encode(data).decode()
        )
        with pytest.raises((ValueError, ValidationError)):
            backend.upload_document(title, DocumentKind.OTHER, upload, trip_id if kind == "trip" else None)
    else:
        with (
            TestingSessionLocal() as session,
            pytest.raises((ValueError, documents.DocumentError)),
        ):
            kwargs = {
                "filename": "sample.txt",
                "content_type": "text/plain",
                "data": data,
                "document_kind": DocumentKind.OTHER,
                "title": title,
            }
            documents.direct_upload(
                session, storage, owner_subject="owner-1", trip_id=trip_id if kind == "trip" else None, **kwargs
            )
    storage.put.assert_not_called()
    assert not list(tmp_path.rglob("*"))
