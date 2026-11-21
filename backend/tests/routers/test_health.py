"""One health shape: liveness, readiness and the summary, with the failure paths the probes exist for."""

import httpx
import pytest
from fastapi.testclient import TestClient

from app.db.session import get_session
from app.main import app
from app.routers import health


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _no_cached_probe(monkeypatch):
    monkeypatch.setattr(health, "_jwks_reachable_until", 0.0)
    monkeypatch.setattr(health.settings, "oidc_jwks_url", None)


class BrokenSession:
    def get_bind(self):
        raise RuntimeError("database down")


def broken_database(monkeypatch):
    def broken_session():
        yield BrokenSession()

    class BrokenSessionLocal:
        def __enter__(self):
            raise RuntimeError("database down")

        def __exit__(self, *exc_info):
            return False

    app.dependency_overrides[get_session] = broken_session
    monkeypatch.setattr(health, "SessionLocal", BrokenSessionLocal)


@pytest.fixture(autouse=True)
def _reset_overrides():
    yield
    app.dependency_overrides.pop(get_session, None)


def test_liveness_needs_no_dependency(client, monkeypatch):
    broken_database(monkeypatch)
    response = client.get("/api/health/liveness")
    assert response.status_code == 200
    assert response.json() == {"status": "alive"}


def test_readiness_is_ready_when_the_database_answers(client):
    response = client.get("/api/health/readiness")
    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


def test_readiness_is_not_ready_without_the_database(client, monkeypatch):
    broken_database(monkeypatch)
    response = client.get("/api/health/readiness")
    assert response.status_code == 503
    assert response.json() == {"status": "not_ready"}
    assert "database down" not in response.text


def test_readiness_is_not_ready_when_the_signing_keys_are_unreachable(client, monkeypatch):
    monkeypatch.setattr(health.settings, "oidc_jwks_url", "https://idp.example/jwks")

    def unreachable(url, timeout):
        raise httpx.ConnectError("refused")

    monkeypatch.setattr(health.httpx, "get", unreachable)
    response = client.get("/api/health/readiness")
    assert response.status_code == 503
    assert response.json() == {"status": "not_ready"}


def test_readiness_remembers_a_reachable_identity_provider_briefly(client, monkeypatch):
    monkeypatch.setattr(health.settings, "oidc_jwks_url", "https://idp.example/jwks")
    calls = []

    def reachable(url, timeout):
        calls.append(url)
        return httpx.Response(200, request=httpx.Request("GET", url))

    monkeypatch.setattr(health.httpx, "get", reachable)
    assert [client.get("/api/health/readiness").status_code for _ in range(3)] == [200, 200, 200]
    assert calls == ["https://idp.example/jwks"]


def test_health_summary_links_both_probes(client, monkeypatch):
    monkeypatch.setattr(health, "APP_COMMIT", "d" * 40)
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body == {
        "status": "ok",
        "version": health.APP_VERSION,
        "commit": "d" * 40,
        "liveness_endpoint": "/api/health/liveness",
        "readiness_endpoint": "/api/health/readiness",
    }
    # The summary links paths the application really serves.
    assert client.get(body["liveness_endpoint"]).status_code == 200
    assert client.get(body["readiness_endpoint"]).status_code == 200


def test_health_summary_reports_an_unavailable_database_with_the_error_shape(client, monkeypatch):
    broken_database(monkeypatch)
    response = client.get("/api/health")
    assert response.status_code == 503
    assert response.json()["errors"][0]["code"] == "database_unavailable"
    assert "database down" not in response.text
