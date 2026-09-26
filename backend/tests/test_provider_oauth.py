"""Provider credentials remain private across processes and OAuth returns."""

from urllib.parse import parse_qs, urlparse

import httpx
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.auth import current_subject
from app.config import settings
from app.database import Base
from app.main import app
from app.media import oauth
from app.secrets import Credential, DatabaseSecretStore, InMemorySecretStore, get_secret_store


def configure(monkeypatch) -> None:
    monkeypatch.setattr(settings, "google_oauth_client_id", "client-id")
    monkeypatch.setattr(settings, "google_oauth_client_secret", "client-secret")
    monkeypatch.setattr(settings, "google_oauth_redirect_uri", "https://travel.example/admin/settings")
    monkeypatch.setattr(settings, "provider_secret_key", Fernet.generate_key().decode())


def test_encrypted_store_persists_owner_credentials_and_one_time_state(tmp_path) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'secrets.db'}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    key = Fernet.generate_key().decode()
    first = DatabaseSecretStore(key, factory)
    first.set_credential(subject="alice", provider=oauth.GOOGLE, credential=Credential("access-secret", "refresh-secret"))
    first.set_pending(subject="alice", provider=oauth.GOOGLE, state="state", verifier="verifier")
    with engine.connect() as conn:
        stored = [row[0] for row in conn.execute(text("SELECT ciphertext FROM provider_secrets"))]
    assert all("access-secret" not in row and "refresh-secret" not in row and "verifier" not in row for row in stored)
    second = DatabaseSecretStore(key, factory)
    assert second.get_credential(subject="alice", provider=oauth.GOOGLE).refresh_token == "refresh-secret"
    assert second.get_credential(subject="bob", provider=oauth.GOOGLE) is None
    assert second.pop_pending(subject="alice", provider=oauth.GOOGLE, state="wrong") is None
    assert second.pop_pending(subject="alice", provider=oauth.GOOGLE, state="state") == "verifier"
    assert second.pop_pending(subject="alice", provider=oauth.GOOGLE, state="state") is None


def test_oauth_start_complete_and_refresh_are_owner_scoped(monkeypatch) -> None:
    configure(monkeypatch)
    store = InMemorySecretStore()
    app.dependency_overrides[current_subject] = lambda: "alice"
    app.dependency_overrides[get_secret_store] = lambda: store
    calls = []

    def token_request(data):
        calls.append(data)
        if data["grant_type"] == "authorization_code":
            return {"access_token": "first-access", "refresh_token": "refresh-secret", "expires_in": 1}
        return {"access_token": "fresh-access", "expires_in": 3600}

    monkeypatch.setattr(oauth, "_post_token", token_request)
    try:
        client = TestClient(app)
        start = client.post("/api/provider-tokens/google_photos_picker/oauth/start")
        assert start.status_code == 200
        authorization = parse_qs(urlparse(start.json()["authorization_url"]).query)
        assert authorization["scope"] == [oauth.SCOPE]
        assert authorization["access_type"] == ["offline"]
        assert authorization["code_challenge_method"] == ["S256"]
        state = authorization["state"][0]
        assert client.post("/api/provider-tokens/google_photos_picker/oauth/complete", json={"code": "code", "state": "wrong"}).status_code == 409
        assert client.post("/api/provider-tokens/google_photos_picker/oauth/complete", json={"code": "code", "state": state}).status_code == 204
        assert client.post("/api/provider-tokens/google_photos_picker/oauth/complete", json={"code": "code", "state": state}).status_code == 409
        assert calls[0]["code_verifier"]
        assert client.get("/api/provider-tokens").json()[0] == {"provider": oauth.GOOGLE, "available": True, "connected": True}
        assert "refresh-secret" not in client.get("/api/provider-tokens").text
        assert oauth.access_token("alice", oauth.GOOGLE, store) == "fresh-access"
        assert calls[1]["refresh_token"] == "refresh-secret"
        assert oauth.access_token("alice", oauth.GOOGLE, store) == "fresh-access"
        assert len(calls) == 2
        assert store.get_credential(subject="bob", provider=oauth.GOOGLE) is None
    finally:
        app.dependency_overrides.clear()


def test_google_disconnect_revokes_refresh_token_before_local_delete(monkeypatch) -> None:
    configure(monkeypatch)
    store = InMemorySecretStore()
    store.set_credential(subject="alice", provider=oauth.GOOGLE, credential=Credential("access", "refresh-secret"))
    app.dependency_overrides[current_subject] = lambda: "alice"
    app.dependency_overrides[get_secret_store] = lambda: store
    requests = []
    actual_client = httpx.Client
    status = [503, 200]

    def client_factory(**kwargs):
        def respond(request):
            requests.append(request)
            return httpx.Response(status.pop(0))

        return actual_client(transport=httpx.MockTransport(respond), **kwargs)

    monkeypatch.setattr(oauth.httpx, "Client", client_factory)
    try:
        client = TestClient(app)
        assert client.delete("/api/provider-tokens/google_photos_picker").status_code == 502
        assert store.get_credential(subject="alice", provider=oauth.GOOGLE) is not None
        assert client.delete("/api/provider-tokens/google_photos_picker").status_code == 204
        assert store.get_credential(subject="alice", provider=oauth.GOOGLE) is None
        assert all(request.content == b"token=refresh-secret" for request in requests)
    finally:
        app.dependency_overrides.clear()
