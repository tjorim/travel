from datetime import UTC, datetime, timedelta

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app.auth import current_subject
from app.config import settings


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
    monkeypatch.setattr("app.auth.jwt.PyJWKClient", lambda _: StaticJwksClient(private_key.public_key()))
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "oidc_audience", "travel-api")
    monkeypatch.setattr(settings, "oidc_issuer_url", "https://auth.example.test/realms/travel")
    monkeypatch.setattr(settings, "oidc_jwks_url", "https://auth.example.test/realms/travel/protocol/openid-connect/certs")

    subject = current_subject(HTTPAuthorizationCredentials(scheme="Bearer", credentials=token), None)

    assert subject == "travel-account-id"


def test_current_subject_rejects_a_wrong_audience(monkeypatch: pytest.MonkeyPatch) -> None:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    token = token_for(private_key, "another-api")
    monkeypatch.setattr("app.auth.jwt.PyJWKClient", lambda _: StaticJwksClient(private_key.public_key()))
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "oidc_audience", "travel-api")
    monkeypatch.setattr(settings, "oidc_issuer_url", "https://auth.example.test/realms/travel")
    monkeypatch.setattr(settings, "oidc_jwks_url", "https://auth.example.test/realms/travel/protocol/openid-connect/certs")

    with pytest.raises(HTTPException, match="Invalid bearer token") as error:
        current_subject(HTTPAuthorizationCredentials(scheme="Bearer", credentials=token), None)

    assert error.value.status_code == 401
