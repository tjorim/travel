"""Public sign-in bootstrap for clients that cannot do RFC 9728 discovery.

Home Assistant's OAuth helper needs the authorization and token URLs and a
client ID up front. This mirrors the ``GET /api/auth/oidc-config`` endpoint of
Worktime and Champagnefestival: endpoints come from the provider's standard
discovery document, so any OIDC provider works without provider-specific paths.
"""

import logging

import httpx
from fastapi import APIRouter, status
from pydantic import BaseModel

from ..config import settings
from ..errors import ApiException

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


class OidcDiscoveryConfig(BaseModel):
    """Public OIDC endpoints and the public PKCE client for Home Assistant."""

    issuer: str
    authorization_url: str
    token_url: str
    end_session_url: str | None = None
    client_id: str


# Discovery results are stable for the process lifetime, like the JWKS cache in
# app.auth. Keyed by issuer and client so a configuration change is picked up;
# failures are never cached.
_config_cache: dict[tuple[str, str], OidcDiscoveryConfig] = {}


def _http_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=10, follow_redirects=False)


async def _discover(issuer: str, client_id: str) -> OidcDiscoveryConfig:
    async with _http_client() as client:
        response = await client.get(f"{issuer}/.well-known/openid-configuration")
    response.raise_for_status()
    data = response.json()
    return OidcDiscoveryConfig(
        issuer=data.get("issuer", issuer),
        authorization_url=data["authorization_endpoint"],
        token_url=data["token_endpoint"],
        end_session_url=data.get("end_session_endpoint"),
        client_id=client_id,
    )


@router.get("/oidc-config", response_model=OidcDiscoveryConfig)
async def oidc_config() -> OidcDiscoveryConfig:
    """Unauthenticated: only public provider URLs and a public client ID, no secret or owner data."""
    if not settings.oidc_issuer_url:
        raise ApiException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OIDC validation is not configured",
            code="oidc_validation_is_not_configured",
        )
    key = (settings.oidc_issuer_url.rstrip("/"), settings.oidc_home_assistant_client_id)
    if (cached := _config_cache.get(key)) is not None:
        return cached
    try:
        config = await _discover(*key)
    except (httpx.HTTPError, KeyError, ValueError) as error:
        logger.error("OIDC discovery failed for %s: %s", key[0], error)
        raise ApiException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OIDC discovery failed",
            code="oidc_discovery_failed",
        ) from error
    _config_cache[key] = config
    return config
