from datetime import UTC, datetime, timedelta

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from jwt.algorithms import RSAAlgorithm
from pydantic import ValidationError
from starlette.requests import Request

from app.auth import DEV_BYPASS_SUBJECT, current_subject
from app.config import Settings, settings

ANONYMOUS = Request({"type": "http", "client": ("203.0.113.9", 1), "headers": []})


class StaticSigningKey:
    def __init__(self, key: rsa.RSAPublicKey) -> None:
        self.key = key


class StaticJwksClient:
    def __init__(self, key: rsa.RSAPublicKey) -> None:
        self.key = key

    def get_signing_key_from_jwt(self, token: str) -> StaticSigningKey:
        return StaticSigningKey(self.key)


def token_for(private_key: rsa.RSAPrivateKey, audience: str) -> str:
    now = datetime.now(UTC)
    return jwt.encode(
        {
            "aud": audience,
            "exp": now + timedelta(minutes=5),
            "iat": now,
            "iss": "https://auth.example.test/realms/travel",
            "sub": "travel-account-id",
        },
        private_key,
        algorithm="RS256",
    )


def test_current_subject_accepts_a_valid_travel_audience_token(monkeypatch: pytest.MonkeyPatch) -> None:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    token = token_for(private_key, "travel-api")
    monkeypatch.setattr("app.auth.signing_keys", lambda _: StaticJwksClient(private_key.public_key()))
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "oidc_audience", "travel-api")
    monkeypatch.setattr(settings, "oidc_issuer_url", "https://auth.example.test/realms/travel")
    monkeypatch.setattr(
        settings, "oidc_jwks_url", "https://auth.example.test/realms/travel/protocol/openid-connect/certs"
    )

    subject = current_subject(ANONYMOUS, HTTPAuthorizationCredentials(scheme="Bearer", credentials=token))

    assert subject == "travel-account-id"


def test_current_subject_rejects_a_wrong_audience(monkeypatch: pytest.MonkeyPatch) -> None:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    token = token_for(private_key, "another-api")
    monkeypatch.setattr("app.auth.signing_keys", lambda _: StaticJwksClient(private_key.public_key()))
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "oidc_audience", "travel-api")
    monkeypatch.setattr(settings, "oidc_issuer_url", "https://auth.example.test/realms/travel")
    monkeypatch.setattr(
        settings, "oidc_jwks_url", "https://auth.example.test/realms/travel/protocol/openid-connect/certs"
    )

    with pytest.raises(HTTPException, match="Invalid bearer token") as error:
        current_subject(ANONYMOUS, HTTPAuthorizationCredentials(scheme="Bearer", credentials=token))

    assert error.value.status_code == 401


def test_current_subject_rejects_a_token_for_the_mcp_resource(monkeypatch: pytest.MonkeyPatch) -> None:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    token = token_for(private_key, "https://travel.example.test/mcp")
    monkeypatch.setattr("app.auth.signing_keys", lambda _: StaticJwksClient(private_key.public_key()))
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "oidc_audience", "travel-api")
    monkeypatch.setattr(settings, "mcp_base_url", "https://travel.example.test/mcp")
    monkeypatch.setattr(settings, "oidc_issuer_url", "https://auth.example.test/realms/travel")
    monkeypatch.setattr(
        settings, "oidc_jwks_url", "https://auth.example.test/realms/travel/protocol/openid-connect/certs"
    )

    with pytest.raises(HTTPException, match="Invalid bearer token") as error:
        current_subject(ANONYMOUS, HTTPAuthorizationCredentials(scheme="Bearer", credentials=token))

    assert error.value.status_code == 401


def test_dev_bypass_token_authenticates_the_fixed_development_owner(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "dev_auth_bypass_token", "local-dev-token")

    subject = current_subject(ANONYMOUS, HTTPAuthorizationCredentials(scheme="Bearer", credentials="local-dev-token"))

    assert subject == DEV_BYPASS_SUBJECT


def test_a_different_token_does_not_trigger_the_dev_bypass(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "dev_auth_bypass_token", "local-dev-token")
    monkeypatch.setattr(settings, "oidc_issuer_url", None)
    monkeypatch.setattr(settings, "oidc_jwks_url", None)

    with pytest.raises(HTTPException) as error:
        current_subject(ANONYMOUS, HTTPAuthorizationCredentials(scheme="Bearer", credentials="another-token"))

    assert error.value.status_code == 503


def test_dev_bypass_is_off_unless_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "dev_auth_bypass_token", "")
    monkeypatch.setattr(settings, "oidc_issuer_url", None)
    monkeypatch.setattr(settings, "oidc_jwks_url", None)

    with pytest.raises(HTTPException) as error:
        current_subject(ANONYMOUS, HTTPAuthorizationCredentials(scheme="Bearer", credentials=""))

    assert error.value.status_code == 503


def test_startup_refuses_the_dev_bypass_outside_development() -> None:
    with pytest.raises(ValidationError, match="TRAVEL_DEV_AUTH_BYPASS_TOKEN"):
        Settings(environment="production", dev_auth_bypass_token="local-dev-token")

    assert Settings(environment="development", dev_auth_bypass_token="local-dev-token").dev_auth_bypass_token


@pytest.fixture
def jwks_endpoint(monkeypatch: pytest.MonkeyPatch):
    """Exercise the real PyJWKClient HTTP/JSON path without an identity provider."""
    import io
    import json

    from app.auth import _cached_signing_keys

    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    key = RSAAlgorithm.to_jwk(private_key.public_key(), as_dict=True)
    state = {
        "keys": [{**key, "kid": "first"}],
        "fetches": 0,
        "now": 1000.0,
        "offline": False,
        "private_key": private_key,
    }

    def open_url(self, request, data=None, timeout=None):
        assert timeout == 3
        state["fetches"] += 1
        if state["offline"]:
            raise TimeoutError("synthetic outage")
        return io.BytesIO(json.dumps({"keys": state["keys"]}).encode())

    _cached_signing_keys.cache_clear()
    monkeypatch.setattr("urllib.request.OpenerDirector.open", open_url)
    monkeypatch.setattr("app.auth.time.monotonic", lambda: state["now"])
    monkeypatch.setattr(settings, "oidc_audience", "travel-api")
    monkeypatch.setattr(settings, "oidc_issuer_url", "https://auth.example.test/realms/travel")
    monkeypatch.setattr(settings, "oidc_jwks_url", "https://auth.example.test/certs")

    def authenticate(kid="first", **overrides):
        claims = jwt.decode(token_for(private_key, "travel-api"), options={"verify_signature": False})
        claims.update(overrides)
        token = jwt.encode(claims, state["private_key"], algorithm="RS256", headers={"kid": kid})
        return current_subject(ANONYMOUS, HTTPAuthorizationCredentials(scheme="Bearer", credentials=token))

    yield state, authenticate
    _cached_signing_keys.cache_clear()


def test_repeated_authentication_reuses_jwks_and_expires(jwks_endpoint):
    state, authenticate = jwks_endpoint
    for _ in range(50):
        assert authenticate() == "travel-account-id"
    assert state["fetches"] == 1
    state["now"] += 301
    assert authenticate() == "travel-account-id"
    assert state["fetches"] == 2


def test_random_unknown_kids_share_one_bounded_refresh(jwks_endpoint):
    state, authenticate = jwks_endpoint
    for index in range(50):
        with pytest.raises(HTTPException) as error:
            authenticate(f"forged-{index}")
        assert error.value.status_code == 401
    assert state["fetches"] == 1
    state["now"] += 31
    for index in range(50):
        with pytest.raises(HTTPException):
            authenticate(f"other-{index}")
    assert state["fetches"] == 2
    assert authenticate() == "travel-account-id"
    assert state["fetches"] == 2


def test_key_rotation_refreshes_after_cooldown_and_removes_old_key(jwks_endpoint):
    state, authenticate = jwks_endpoint
    assert authenticate() == "travel-account-id"
    state["private_key"] = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    key = RSAAlgorithm.to_jwk(state["private_key"].public_key(), as_dict=True)
    state["keys"] = [{**key, "kid": "rotated"}]
    with pytest.raises(HTTPException):
        authenticate("rotated")
    assert state["fetches"] == 1
    state["now"] += 31
    assert authenticate("rotated") == "travel-account-id"
    assert state["fetches"] == 2
    with pytest.raises(HTTPException) as error:
        authenticate("first")
    assert error.value.status_code == 401
    assert state["fetches"] == 2


def test_outage_is_503_and_retries_are_bounded(jwks_endpoint):
    state, authenticate = jwks_endpoint
    state["offline"] = True
    for index in range(50):
        with pytest.raises(HTTPException) as error:
            authenticate(f"unknown-{index}")
        assert error.value.status_code == 503
    assert state["fetches"] == 1
    state["offline"] = False
    state["now"] += 31
    assert authenticate() == "travel-account-id"


def test_cached_known_key_survives_failed_unknown_key_refresh(jwks_endpoint):
    state, authenticate = jwks_endpoint
    assert authenticate() == "travel-account-id"
    state["offline"] = True
    state["now"] += 31
    with pytest.raises(HTTPException) as error:
        authenticate("unknown")
    assert error.value.status_code == 503
    assert authenticate() == "travel-account-id"
    state["now"] += 301
    with pytest.raises(HTTPException) as error:
        authenticate()
    assert error.value.status_code == 503


@pytest.mark.parametrize("claims", [{"aud": "wrong"}, {"iss": "wrong"}, {"sub": ""}, {"exp": 1}])
def test_cached_keys_keep_claim_validation_strict(jwks_endpoint, claims):
    _, authenticate = jwks_endpoint
    with pytest.raises(HTTPException) as error:
        authenticate(**claims)
    assert error.value.status_code == 401


def test_concurrent_cold_authentication_shares_one_fetch(jwks_endpoint):
    from concurrent.futures import ThreadPoolExecutor

    state, authenticate = jwks_endpoint
    with ThreadPoolExecutor(max_workers=8) as pool:
        subjects = list(pool.map(lambda _: authenticate(), range(24)))
    assert subjects == ["travel-account-id"] * 24
    assert state["fetches"] == 1
