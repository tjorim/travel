"""The failed-authentication limit of the owner API (#46); the MCP route's cases are in test_mcp_server.py."""

from collections.abc import Generator

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.requests import Request

from app import authlimit
from app.authlimit import FailedAuthenticationLimiter, failed_authentication
from app.config import Settings, settings
from app.database import Base, get_session
from app.main import app
from tests.test_auth import StaticJwksClient, token_for

ISSUER = "https://auth.example.test/realms/travel"
LIMIT = 3

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def override_session() -> Generator[Session]:
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture(autouse=True)
def database() -> Generator[None]:
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    app.dependency_overrides[get_session] = override_session
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def identity(monkeypatch: pytest.MonkeyPatch) -> rsa.RSAPrivateKey:
    """An owner API that verifies tokens signed by the returned key."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    failed_authentication.enabled = True
    monkeypatch.setattr(settings, "auth_failure_limit", LIMIT)
    monkeypatch.setattr(settings, "auth_failure_window_seconds", 60)
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "dev_auth_bypass_token", None)
    monkeypatch.setattr(settings, "oidc_audience", "travel-api")
    monkeypatch.setattr(settings, "oidc_issuer_url", ISSUER)
    monkeypatch.setattr(settings, "oidc_jwks_url", f"{ISSUER}/certs")
    monkeypatch.setattr("app.auth.signing_keys", lambda _: StaticJwksClient(key.public_key()))
    return key


def client(host: str = "8.8.8.8", **headers: str) -> TestClient:
    return TestClient(app, client=(host, 50000), headers=headers)


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def forged() -> dict[str, str]:
    return bearer(token_for(rsa.generate_private_key(public_exponent=65537, key_size=2048), "travel-api"))


def exhaust(visitor: TestClient) -> None:
    for _ in range(LIMIT):
        assert visitor.get("/api/trips", headers=forged()).status_code == 401


def test_forged_tokens_are_refused_with_429_and_retry_after_after_the_threshold(identity: rsa.RSAPrivateKey) -> None:
    visitor = client()
    exhaust(visitor)

    secret = token_for(identity, "travel-api")
    limited = visitor.get("/api/trips", headers=bearer(secret))

    assert limited.status_code == 429
    assert 1 <= int(limited.headers["retry-after"]) <= 60
    assert limited.headers["cache-control"] == "no-store"
    assert limited.json() == {
        "detail": "Too many failed authentication attempts",
        "errors": [{"code": "rate_limited", "params": {}, "path": []}],
    }
    assert secret not in limited.text


def test_successful_requests_are_never_counted_or_limited(identity: rsa.RSAPrivateKey) -> None:
    visitor = client()
    valid = bearer(token_for(identity, "travel-api"))
    for _ in range(LIMIT * 5):
        assert visitor.get("/api/trips", headers=valid).status_code == 200
    exhaust(visitor)
    # Successes between failures do not reset or add to the count.
    assert visitor.get("/api/trips", headers=forged()).status_code == 429


def test_missing_credentials_are_not_counted(identity: rsa.RSAPrivateKey) -> None:
    visitor = client()
    for _ in range(LIMIT * 3):
        assert visitor.get("/api/trips").status_code == 401
    assert visitor.get("/api/trips", headers=bearer(token_for(identity, "travel-api"))).status_code == 200


def test_identity_provider_outage_is_503_and_never_counted(
    identity: rsa.RSAPrivateKey, monkeypatch: pytest.MonkeyPatch
) -> None:
    class Offline:
        def get_signing_key_from_jwt(self, token: str) -> object:
            raise jwt.PyJWKClientConnectionError("Signing keys unavailable")

    visitor = client()
    valid = bearer(token_for(identity, "travel-api"))
    with monkeypatch.context() as outage:
        outage.setattr("app.auth.signing_keys", lambda _: Offline())
        for _ in range(LIMIT * 3):
            response = visitor.get("/api/trips", headers=valid)
            assert response.status_code == 503
    assert visitor.get("/api/trips", headers=valid).status_code == 200


def test_unconfigured_validation_is_not_counted(identity: rsa.RSAPrivateKey, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "oidc_jwks_url", None)
    visitor = client()
    for _ in range(LIMIT * 2):
        assert visitor.get("/api/trips", headers=forged()).status_code == 503


def test_clients_are_counted_separately_by_trusted_proxy_address(identity: rsa.RSAPrivateKey) -> None:
    proxy = client("10.0.0.2", **{"X-Real-IP": "198.51.100.7"})
    exhaust(proxy)

    assert proxy.get("/api/trips", headers=forged()).status_code == 429
    other = client("10.0.0.2", **{"X-Real-IP": "198.51.100.8"})
    assert other.get("/api/trips", headers=forged()).status_code == 401
    assert client().get("/api/trips", headers=forged()).status_code == 401


def test_a_public_peer_cannot_dodge_the_limit_with_a_forwarded_address(identity: rsa.RSAPrivateKey) -> None:
    exhaust(client(**{"X-Real-IP": "198.51.100.1"}))

    assert client(**{"X-Real-IP": "198.51.100.2"}).get("/api/trips", headers=forged()).status_code == 429
    assert client(**{"X-Real-IP": "198.51.100.2"}).get("/api/trips", headers=forged()).status_code == 429


def test_an_ipv6_subscriber_shares_one_bucket_across_its_prefix(identity: rsa.RSAPrivateKey) -> None:
    exhaust(client("2001:db8:1:2::1"))

    assert client("2001:db8:1:2:ffff::9").get("/api/trips", headers=forged()).status_code == 429
    assert client("2001:db8:1:3::1").get("/api/trips", headers=forged()).status_code == 401
    behind_proxy = client("10.0.0.2", **{"X-Real-IP": "2001:db8:1:2::77"})
    assert behind_proxy.get("/api/trips", headers=forged()).status_code == 429


def test_a_client_recovers_when_its_window_ends(identity: rsa.RSAPrivateKey, monkeypatch: pytest.MonkeyPatch) -> None:
    now = [1000.0]
    monkeypatch.setattr(authlimit.time, "monotonic", lambda: now[0])
    visitor = client()
    valid = bearer(token_for(identity, "travel-api"))
    exhaust(visitor)

    assert visitor.get("/api/trips", headers=valid).status_code == 429
    now[0] += 59
    assert visitor.get("/api/trips", headers=valid).status_code == 429
    now[0] += 2
    assert visitor.get("/api/trips", headers=valid).status_code == 200
    # A fresh window starts counting from zero.
    exhaust(visitor)
    assert visitor.get("/api/trips", headers=valid).status_code == 429


def test_a_disabled_limiter_never_throttles(identity: rsa.RSAPrivateKey) -> None:
    failed_authentication.enabled = False
    visitor = client()
    for _ in range(LIMIT * 3):
        assert visitor.get("/api/trips", headers=forged()).status_code == 401


def test_the_rate_limit_switch_disables_it_too(identity: rsa.RSAPrivateKey, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "rate_limit_enabled", False)
    visitor = client()
    for _ in range(LIMIT * 3):
        assert visitor.get("/api/trips", headers=forged()).status_code == 401


def request_from(host: str) -> Request:
    return Request({"type": "http", "client": (host, 1), "headers": []})


def test_counter_memory_is_bounded(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(authlimit, "MAX_CLIENTS", 3)
    limiter = FailedAuthenticationLimiter()
    for last in range(1, 8):
        limiter.record_failure(request_from(f"198.51.100.{last}"))

    assert len(limiter._windows) == 3
    assert set(limiter._windows) == {"198.51.100.5", "198.51.100.6", "198.51.100.7"}


def test_expired_windows_are_dropped_before_live_ones(monkeypatch: pytest.MonkeyPatch) -> None:
    now = [0.0]
    monkeypatch.setattr(authlimit.time, "monotonic", lambda: now[0])
    monkeypatch.setattr(authlimit, "MAX_CLIENTS", 2)
    limiter = FailedAuthenticationLimiter()
    limiter.record_failure(request_from("198.51.100.1"))
    now[0] = 30
    limiter.record_failure(request_from("198.51.100.2"))
    now[0] = 70
    limiter.record_failure(request_from("198.51.100.3"))

    assert set(limiter._windows) == {"198.51.100.2", "198.51.100.3"}


def test_settings_reject_a_non_positive_threshold_or_window() -> None:
    with pytest.raises(ValueError, match="auth_failure_limit"):
        Settings(auth_failure_limit=0)
    with pytest.raises(ValueError, match="auth_failure_window_seconds"):
        Settings(auth_failure_window_seconds=0)
