import hmac
from typing import Annotated

import jwt
from fastapi import HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import settings

bearer_scheme = HTTPBearer(auto_error=False)

# The owner every request authenticated with TRAVEL_DEV_AUTH_BYPASS_TOKEN acts as.
DEV_BYPASS_SUBJECT = "dev-bypass-user"


def current_subject(credentials: Annotated[HTTPAuthorizationCredentials | None, Security(bearer_scheme)]) -> str:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="A bearer token is required")
    if settings.dev_auth_bypass_token and hmac.compare_digest(credentials.credentials, settings.dev_auth_bypass_token):
        return DEV_BYPASS_SUBJECT
    if not settings.oidc_issuer_url or not settings.oidc_jwks_url:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="OIDC validation is not configured")
    try:
        signing_key = jwt.PyJWKClient(settings.oidc_jwks_url).get_signing_key_from_jwt(credentials.credentials)
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
    except jwt.PyJWTError as error:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid bearer token") from error
