import base64
from unittest.mock import Mock

import pytest
from pydantic import ValidationError
from test_documents import TestingSessionLocal, client_for, create_trip, setup_function, teardown_function

from app import mcp_server
from app.document import service as documents
from app.library import service as library
from app.main import app
from app.mcp_server import BinaryUpload, TravelMcpBackend
from app.models import DocumentKind
from app.storage import LocalObjectStorage, get_storage

__all__ = ["setup_function", "teardown_function"]


@pytest.mark.parametrize("title", ["", "x" * 161, "unsafe\x00title", "unsafe\ud800title"])
@pytest.mark.parametrize("kind", ["trip", "library"])
@pytest.mark.parametrize("transport", ["http", "mcp", "service"])
def test_invalid_title_never_writes_storage(title, kind, transport, tmp_path, monkeypatch):
    client = client_for("owner-1", tmp_path)
    trip_id = create_trip(client)["id"]
    storage = Mock(wraps=LocalObjectStorage(root=str(tmp_path)))
    app.dependency_overrides[get_storage] = lambda: storage
    monkeypatch.setattr(mcp_server, "get_storage", lambda: storage)
    monkeypatch.setattr(mcp_server.settings, "mcp_development_subject", "owner-1")
    monkeypatch.setattr(mcp_server.settings, "environment", "development")
    data = f"synthetic-{kind}-{transport}-{ascii(title)}".encode()
    if transport == "http":
        if "\ud800" in title:
            pytest.skip("Surrogates cannot be encoded as HTTP multipart UTF-8")
        url = f"/api/trips/{trip_id}/documents/uploads" if kind == "trip" else "/api/library/documents/uploads"
        response = client.post(
            url, data={"title": title, "document_kind": "other"}, files={"file": ("sample.txt", data, "text/plain")}
        )
        assert response.status_code == 422
    elif transport == "mcp":
        backend = TravelMcpBackend(TestingSessionLocal)
        upload = BinaryUpload(
            filename="sample.txt", content_type="text/plain", data_base64=base64.b64encode(data).decode()
        )
        with pytest.raises((ValueError, ValidationError)):
            if kind == "trip":
                backend.upload_document(trip_id, title, DocumentKind.OTHER, upload)
            else:
                backend.upload_library_document(title, DocumentKind.OTHER, upload)
    else:
        with (
            TestingSessionLocal() as session,
            pytest.raises((ValueError, documents.DocumentError, library.LibraryError)),
        ):
            kwargs = {
                "filename": "sample.txt",
                "content_type": "text/plain",
                "data": data,
                "document_kind": DocumentKind.OTHER,
                "title": title,
            }
            if kind == "trip":
                documents.direct_upload(session, storage, trip_id=trip_id, **kwargs)
            else:
                library.direct_upload(session, storage, owner_subject="owner-1", linked_trip_id=None, **kwargs)
    storage.put.assert_not_called()
    assert not list(tmp_path.rglob("*"))
