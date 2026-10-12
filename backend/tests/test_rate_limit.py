from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.requests import Request

from app.config import Settings, settings
from app.database import Base, get_session
from app.main import app
from app.ratelimit import get_client_ip, limiter

TOKEN = "probe-token-that-must-not-be-echoed"
UNLISTED_PRIVACY = {"cache-control": "no-store, private", "x-robots-tag": "noindex, noarchive"}


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
def limits(monkeypatch: pytest.MonkeyPatch) -> None:
    limiter.enabled = True
    monkeypatch.setattr(settings, "rate_limit_default", "3/minute")
    monkeypatch.setattr(settings, "rate_limit_shared", "2/minute")


def visitor(host: str = "8.8.8.8", **headers: str) -> TestClient:
    return TestClient(app, client=(host, 50000), headers=headers)


def request_from(host: str | None, **headers: str) -> Request:
    return Request(
        {
            "type": "http",
            "client": (host, 1) if host else None,
            "headers": [(key.lower().encode(), value.encode()) for key, value in headers.items()],
        }
    )


def test_public_routes_share_one_bounded_bucket(limits: None) -> None:
    client = visitor()
    assert client.get("/api/public/trips").status_code == 200
    assert client.get("/api/public/trips/no-trip").status_code == 404
    assert client.get("/api/public/trips/other/files/f1").status_code == 404
    limited = client.get("/api/public/trips/no-trip/navigation/n1")
    assert limited.status_code == 429
    assert limited.json() == {
        "detail": "Too many requests",
        "errors": [{"code": "rate_limited", "params": {}, "path": []}],
    }
    assert limited.headers["cache-control"] == "no-store"
    assert int(limited.headers["retry-after"]) >= 1


def test_shared_link_probes_are_throttled_together_without_echoing_the_token(limits: None) -> None:
    client = visitor()
    assert client.get(f"/api/shared/{TOKEN}").status_code == 404
    assert client.get("/api/shared/another-token/files/f1").status_code == 404
    limited = client.get(f"/api/shared/{TOKEN}/files/f1")
    assert limited.status_code == 429
    assert TOKEN not in limited.text
    assert TOKEN not in str(limited.headers)
    for header, value in UNLISTED_PRIVACY.items():
        assert limited.headers[header] == value
    assert limited.headers["referrer-policy"] == "no-referrer"
    assert int(limited.headers["retry-after"]) >= 1
    # The stricter unlisted bucket is separate from the public one.
    assert client.get("/api/public/trips").status_code == 200


def test_clients_are_counted_separately_by_trusted_proxy_address(limits: None) -> None:
    first = visitor("10.0.0.2", **{"X-Real-IP": "93.184.216.1"})
    second = visitor("10.0.0.2", **{"X-Real-IP": "93.184.216.2"})
    assert [first.get("/api/shared/a").status_code for _ in range(3)] == [404, 404, 429]
    assert second.get("/api/shared/a").status_code == 404


def test_a_public_peer_cannot_choose_its_own_bucket(limits: None) -> None:
    statuses = [visitor(**{"X-Real-IP": f"93.184.216.{n}"}).get("/api/shared/a").status_code for n in range(3)]
    assert statuses == [404, 404, 429]


def test_owner_routes_are_not_limited(limits: None) -> None:
    client = visitor()
    assert all(client.get("/api/health").status_code in {200, 503} for _ in range(10))


def test_disabled_limiter_never_throttles(limits: None) -> None:
    limiter.enabled = False
    client = visitor()
    assert all(client.get("/api/shared/a").status_code == 404 for _ in range(10))


def test_client_ip_from_trusted_proxy_header() -> None:
    assert get_client_ip(request_from("172.18.0.3", **{"X-Real-IP": "93.184.216.9"})) == "93.184.216.9"
    assert get_client_ip(request_from("127.0.0.1", **{"X-Real-IP": " 93.184.216.9 "})) == "93.184.216.9"


def test_client_ip_ignores_the_header_from_a_public_peer() -> None:
    assert get_client_ip(request_from("8.8.8.8", **{"X-Real-IP": "93.184.216.9"})) == "8.8.8.8"


def test_client_ip_falls_back_to_the_peer_for_a_missing_or_malformed_header() -> None:
    assert get_client_ip(request_from("172.18.0.3")) == "172.18.0.3"
    assert get_client_ip(request_from("172.18.0.3", **{"X-Real-IP": "not an address"})) == "172.18.0.3"


def test_client_ip_is_never_empty() -> None:
    assert get_client_ip(request_from(None)) == "unknown"
    assert get_client_ip(request_from("testclient")) == "testclient"


def test_client_ip_groups_an_ipv6_subscriber_prefix() -> None:
    first = get_client_ip(request_from("172.18.0.3", **{"X-Real-IP": "2001:db8:1:2::1"}))
    second = get_client_ip(request_from("172.18.0.3", **{"X-Real-IP": "2001:db8:1:2:aaaa::9"}))
    assert first == second == "2001:db8:1:2::"
    assert get_client_ip(request_from("8.8.8.8", **{"X-Real-IP": "::ffff:93.184.216.9"})) == "8.8.8.8"
    assert get_client_ip(request_from("172.18.0.3", **{"X-Real-IP": "::ffff:93.184.216.9"})) == "93.184.216.9"


@pytest.mark.parametrize("field", ["rate_limit_default", "rate_limit_shared"])
def test_settings_reject_an_unparsable_limit(field: str) -> None:
    with pytest.raises(ValidationError):
        Settings(**{field: "often"})
    assert Settings(**{field: "30/minute;300/hour"})
