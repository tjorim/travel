"""Sign-in endpoints advertised by the Travel origin, validated before use."""

from collections.abc import Mapping
from urllib.parse import urlsplit

from homeassistant.helpers import config_entry_oauth2_flow

from .const import DOMAIN

CONF_AUTHORIZATION_URL = "authorization_url"
CONF_TOKEN_URL = "token_url"
CONF_CLIENT_ID = "client_id"


def _https_url(value: object) -> str:
    if not isinstance(value, str):
        raise TypeError("Sign-in endpoints must be URLs")
    url = urlsplit(value)
    if url.scheme != "https" or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ValueError("Sign-in endpoints must be plain HTTPS URLs")
    return value


def validated_config(config: object) -> dict[str, str]:
    """Return a trusted-shape config, or raise ValueError (TypeError if a value has the wrong type).

    Both endpoints must be HTTPS and on one host so that a token request never
    goes to a different server than the sign-in page.
    """
    if not isinstance(config, Mapping):
        raise TypeError("Sign-in configuration must be an object")
    authorization_url = _https_url(config.get(CONF_AUTHORIZATION_URL))
    token_url = _https_url(config.get(CONF_TOKEN_URL))
    client_id = config.get(CONF_CLIENT_ID)
    if urlsplit(authorization_url).netloc.lower() != urlsplit(token_url).netloc.lower():
        raise ValueError("Sign-in endpoints must share one host")
    if not isinstance(client_id, str) or not client_id.strip():
        raise ValueError("Missing client ID")
    return {CONF_AUTHORIZATION_URL: authorization_url, CONF_TOKEN_URL: token_url, CONF_CLIENT_ID: client_id}


async def async_fetch_config(session, origin: str) -> dict[str, str]:
    """Read the public sign-in configuration from the Travel origin."""
    async with session.get(f"{origin.rstrip('/')}/api/auth/oidc-config", allow_redirects=False) as response:
        if response.status != 200:
            raise ValueError("Travel did not advertise sign-in endpoints")
        return validated_config(await response.json(content_type=None))


def implementation(hass, config: dict[str, str]):
    """Public PKCE client: HA stores no secret and no application credential."""
    return config_entry_oauth2_flow.LocalOAuth2ImplementationWithPkce(
        hass, DOMAIN, config[CONF_CLIENT_ID], config[CONF_AUTHORIZATION_URL], config[CONF_TOKEN_URL]
    )
