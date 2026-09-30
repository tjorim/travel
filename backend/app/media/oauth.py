"""Google Photos authorization-code exchange, refresh, and revocation."""

import base64
import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

import httpx

from ..config import settings
from ..secrets import Credential, SecretStore
from .providers import ProviderUnavailableError

GOOGLE = "google_photos_picker"
SCOPE = "https://www.googleapis.com/auth/photospicker.mediaitems.readonly"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"


def configured() -> bool:
    return bool(
        settings.google_oauth_client_id
        and settings.google_oauth_client_secret
        and settings.google_oauth_redirect_uri
        and settings.provider_secret_key
    )


def begin(subject: str, store: SecretStore) -> str:
    if not configured():
        raise ProviderUnavailableError(
            "Google Photos connection is not configured", code="google_photos_connection_is_not_configured"
        )
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    store.set_pending(subject=subject, provider=GOOGLE, state=state, verifier=verifier)
    query = urlencode(
        {
            "client_id": settings.google_oauth_client_id,
            "redirect_uri": settings.google_oauth_redirect_uri,
            "response_type": "code",
            "scope": SCOPE,
            "access_type": "offline",
            "prompt": "consent",
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
    )
    return f"https://accounts.google.com/o/oauth2/v2/auth?{query}"


def _post_token(data: dict[str, str]) -> dict:
    try:
        with httpx.Client(timeout=15) as client:
            response = client.post(TOKEN_URL, data=data)
            response.raise_for_status()
            body = response.json()
            if not isinstance(body, dict):
                raise ValueError("Invalid token response")
            return body
    except (httpx.HTTPError, ValueError) as error:
        # Provider responses may contain credentials; never include them in errors.
        raise ProviderUnavailableError(
            "Google authorization failed; reconnect in Settings",
            code="google_authorization_failed_reconnect_in_settings",
        ) from error


def _credential(body: dict, refresh_token: str | None = None) -> Credential:
    if not body.get("access_token") or not (body.get("refresh_token") or refresh_token):
        raise ProviderUnavailableError(
            "Google did not grant offline access; reconnect in Settings",
            code="google_did_not_grant_offline_access_reconnect_in_settings",
        )
    try:
        expires = datetime.now(UTC) + timedelta(seconds=max(int(body.get("expires_in", 3600)) - 60, 0))
    except (ValueError, TypeError, OverflowError) as error:
        raise ProviderUnavailableError(
            "Media provider returned an invalid response", code="provider_invalid_response"
        ) from error
    return Credential(body["access_token"], body.get("refresh_token") or refresh_token, expires.isoformat())


def complete(subject: str, store: SecretStore, code: str, state: str) -> None:
    if not configured():
        raise ProviderUnavailableError(
            "Google Photos connection is not configured", code="google_photos_connection_is_not_configured"
        )
    verifier = store.pop_pending(subject=subject, provider=GOOGLE, state=state)
    if not verifier:
        raise ProviderUnavailableError(
            "Authorization expired or did not match this owner",
            code="authorization_expired_or_did_not_match_this_owner",
        )
    body = _post_token(
        {
            "client_id": settings.google_oauth_client_id or "",
            "client_secret": settings.google_oauth_client_secret or "",
            "redirect_uri": settings.google_oauth_redirect_uri or "",
            "grant_type": "authorization_code",
            "code": code,
            "code_verifier": verifier,
        }
    )
    store.set_credential(subject=subject, provider=GOOGLE, credential=_credential(body))


def access_token(subject: str, provider: str, store: SecretStore) -> str:
    credential = store.get_credential(subject=subject, provider=provider)
    if credential is None:
        raise ProviderUnavailableError(
            "The owner has not connected this provider", code="the_owner_has_not_connected_this_provider"
        )
    if not credential.expired():
        return credential.access_token
    if provider != GOOGLE or not credential.refresh_token or not configured():
        raise ProviderUnavailableError(
            "Provider connection expired; reconnect in Settings",
            code="provider_connection_expired_reconnect_in_settings",
        )
    body = _post_token(
        {
            "client_id": settings.google_oauth_client_id or "",
            "client_secret": settings.google_oauth_client_secret or "",
            "grant_type": "refresh_token",
            "refresh_token": credential.refresh_token,
        }
    )
    fresh = _credential(body, credential.refresh_token)
    store.set_credential(subject=subject, provider=provider, credential=fresh)
    return fresh.access_token


def revoke(subject: str, provider: str, store: SecretStore) -> None:
    credential = store.get_credential(subject=subject, provider=provider)
    if provider == GOOGLE and credential and credential.refresh_token:
        token = credential.refresh_token
        try:
            with httpx.Client(timeout=15) as client:
                response = client.post(REVOKE_URL, data={"token": token})
                # A token already revoked at Google has the desired remote state.
                try:
                    error_code = response.json().get("error") if response.status_code == 400 else None
                except ValueError:
                    error_code = None
                if error_code == "invalid_token":
                    pass
                else:
                    response.raise_for_status()
        except httpx.HTTPError as error:
            raise ProviderUnavailableError(
                "Google did not confirm revocation; try again", code="google_did_not_confirm_revocation_try_again"
            ) from error
    store.revoke_token(subject=subject, provider=provider)
