import hmac
import time
from functools import lru_cache
from threading import Lock
from typing import Annotated

import jwt
from fastapi import Request, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .authlimit import failed_authentication, refuse_throttled_client
from .config import settings
from .errors import ApiException

bearer_scheme = HTTPBearer(auto_error=False)

# The owner every request authenticated with TRAVEL_DEV_AUTH_BYPASS_TOKEN acts as.
DEV_BYPASS_SUBJECT = "dev-bypass-user"


# Bound network work per worker, including requests with a different forged kid each time.
JWKS_LIFESPAN_SECONDS = 300
JWKS_REFRESH_INTERVAL_SECONDS = 30
JWKS_TIMEOUT_SECONDS = 3


class CachedSigningKeys:
    def __init__(self, url: str) -> None:
        self.client = jwt.PyJWKClient(
            url,
            cache_jwk_set=True,
            cache_keys=False,
            lifespan=JWKS_LIFESPAN_SECONDS,
            timeout=JWKS_TIMEOUT_SECONDS,
        )
        self.lock = Lock()
        self.next_refresh = 0.0
        self.expires = 0.0
        self.keys: list[jwt.PyJWK] = []
        self.failure: Exception | None = None

    def get_signing_key_from_jwt(self, token: str) -> jwt.PyJWK:
        kid = jwt.get_unverified_header(token).get("kid")
        if not isinstance(kid, str) or not kid:
            raise jwt.InvalidTokenError("missing key ID")
        with self.lock:
            now = time.monotonic()
            key = self.client.match_kid(self.keys, kid) if now < self.expires else None
            if key is not None:
                return key
            if now >= self.next_refresh:
                self.next_refresh = now + JWKS_REFRESH_INTERVAL_SECONDS
                try:
                    self.keys = self.client.get_signing_keys(refresh=True)
                except (jwt.PyJWKClientError, ValueError) as error:
                    self.failure = error
                else:
                    self.failure = None
                    self.expires = time.monotonic() + JWKS_LIFESPAN_SECONDS
            if self.failure is not None:
                raise jwt.PyJWKClientConnectionError("Signing keys unavailable") from self.failure
            key = self.client.match_kid(self.keys, kid) if now < self.expires else None
            if key is None:
                raise jwt.InvalidTokenError("unknown key ID")
            return key


signing_keys_lock = Lock()


@lru_cache(maxsize=1)
def _cached_signing_keys(url: str) -> CachedSigningKeys:
    return CachedSigningKeys(url)


def signing_keys(url: str) -> CachedSigningKeys:
    # lru_cache alone permits duplicate construction on concurrent cold calls.
    with signing_keys_lock:
        return _cached_signing_keys(url)


def current_subject(
    request: Request, credentials: Annotated[HTTPAuthorizationCredentials | None, Security(bearer_scheme)]
) -> str:
    if credentials is None:
        raise ApiException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="A bearer token is required", code="unauthorized"
        )
    # Refuse a client over the failed-attempt threshold before any token is parsed or verified (#46).
    refuse_throttled_client(request)
    if settings.dev_auth_bypass_token and hmac.compare_digest(credentials.credentials, settings.dev_auth_bypass_token):
        return DEV_BYPASS_SUBJECT
    if not settings.oidc_issuer_url or not settings.oidc_jwks_url:
        raise ApiException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OIDC validation is not configured",
            code="oidc_validation_is_not_configured",
        )
    try:
        signing_key = signing_keys(settings.oidc_jwks_url).get_signing_key_from_jwt(credentials.credentials)
        claims = jwt.decode(
            credentials.credentials,
            signing_key.key,
            algorithms=["RS256", "ES256"],
            audience=settings.oidc_audience,
            issuer=settings.oidc_issuer_url,
        )
        subject = claims.get("sub")
        if not isinstance(subject, str) or not subject:
            raise jwt.InvalidTokenError("missing subject")
        return subject
    except jwt.PyJWKClientConnectionError as error:
        raise ApiException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OIDC signing keys are unavailable",
            code="oidc_validation_is_not_configured",
        ) from error
    except jwt.PyJWTError as error:
        # Only a refused token counts; the outage above and the unconfigured 503 never do.
        failed_authentication.record_failure(request)
        raise ApiException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid bearer token", code="unauthorized"
        ) from error
