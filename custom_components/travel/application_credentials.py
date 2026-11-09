"""Use an explicitly configured Keycloak realm and HA-managed credentials."""

from urllib.parse import urlsplit

from homeassistant.helpers.config_entry_oauth2_flow import LocalOAuth2ImplementationWithPkce


async def async_get_auth_implementation(hass, auth_domain, credential):
    # The application credential's Name is the realm issuer URL; no discovery fetch or token forwarding.
    issuer = credential.name.rstrip("/") if credential.name else ""
    url = urlsplit(issuer)
    if (
        url.scheme != "https"
        or not url.hostname
        or url.username
        or url.password
        or url.query
        or url.fragment
        or not url.path.startswith("/realms/")
    ):
        raise ValueError("Application credential Name must be an HTTPS Keycloak realm issuer URL")
    return LocalOAuth2ImplementationWithPkce(
        hass,
        auth_domain,
        credential.client_id,
        issuer + "/protocol/openid-connect/auth",
        issuer + "/protocol/openid-connect/token",
        client_secret=credential.client_secret,
    )
