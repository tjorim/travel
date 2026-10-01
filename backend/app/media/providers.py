"""Media source providers behind one narrow interface.

`direct_device` (the durable fallback, always available) does not need a
provider: the router copies uploaded bytes straight to storage. Everything
here is for provider-mediated imports, where the owner selects items in the
provider's own UI (Google Photos Picker, and — only once GoPro grants beta
access — GoPro Cloud) and the app copies only what was selected. A provider
implementation never returns a durable delivery URL: `fetch_item` always
returns bytes for the service layer to hash, store, and record, so a
provider URL or token can never become the canonical file reference.
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from functools import wraps
from typing import Protocol

import httpx

from ..config import settings
from ..errors import ServiceError
from ..models import ImportProvider


class ProviderError(ServiceError, RuntimeError):
    """One provider call failed. Callers record this on the affected
    `ImportRecord` (or refuse to start a session) rather than raising past a
    whole-session import — a single bad item must not block the rest."""


class ProviderUnavailableError(ProviderError):
    """The provider cannot be used right now: no owner token on file, or (for
    GoPro Cloud) beta access not yet enabled. The product must stay fully
    usable without it — this is a normal, expected condition, not a bug."""


@dataclass(frozen=True)
class ProviderSession:
    provider_session_id: str
    picker_uri: str | None
    expires_at: datetime | None


@dataclass(frozen=True)
class ProviderSessionStatus:
    ready: bool


@dataclass(frozen=True)
class ProviderMediaItem:
    provider_item_id: str
    filename: str
    content_type: str
    captured_at: datetime | None


class MediaProvider(Protocol):
    provider: ImportProvider

    def create_session(self, *, access_token: str) -> ProviderSession: ...

    def poll_session(self, *, access_token: str, provider_session_id: str) -> ProviderSessionStatus: ...

    def list_selected_items(self, *, access_token: str, provider_session_id: str) -> list[ProviderMediaItem]: ...

    def fetch_item(self, *, access_token: str, item: ProviderMediaItem) -> bytes: ...


def _require_token(access_token: str | None) -> str:
    if not access_token:
        raise ProviderUnavailableError(
            "The owner has not connected this provider", code="the_owner_has_not_connected_this_provider"
        )
    return access_token


def download_bounded(http: httpx.Client, url: str) -> bytes:
    """Stream one provider download, stopping as soon as it passes the upload limit.

    Keeps a provider import under the same `media_max_upload_bytes` as a direct
    upload without buffering an oversized item first.
    """
    limit = settings.media_max_upload_bytes
    data = bytearray()
    with http.stream("GET", url) as response:
        response.raise_for_status()
        for chunk in response.iter_bytes():
            data += chunk
            if len(data) > limit:
                raise ProviderError(
                    "Imported item exceeds the maximum size", code="imported_item_exceeds_the_maximum_size"
                )
    return bytes(data)


def safe_provider_response[**P, R](call: Callable[P, R]) -> Callable[P, R]:
    """Malformed remote data is a provider failure, without echoing its contents."""

    @wraps(call)
    def checked(*args: P.args, **kwargs: P.kwargs) -> R:
        try:
            return call(*args, **kwargs)
        except ServiceError:
            raise
        except (ValueError, KeyError, TypeError, AttributeError) as error:
            raise ProviderError(
                "Media provider returned an invalid response", code="provider_invalid_response"
            ) from error

    return checked


class GooglePhotosPickerProvider:
    """Google Photos Picker API (https://developers.google.com/photos/picker).

    The owner opens `picker_uri` in a browser and selects items there; Google
    never hands the app blanket library access. `poll_session` reflects
    `mediaItemsSet`, and `list_selected_items`/`fetch_item` only ever see
    items the owner explicitly picked in that session.
    """

    provider = ImportProvider.GOOGLE_PHOTOS_PICKER

    def __init__(self, api_base: str | None = None, client: httpx.Client | None = None) -> None:
        self.api_base = api_base or settings.google_photos_picker_api_base
        self._client = client

    def _http(self, access_token: str) -> httpx.Client:
        return self._client or httpx.Client(
            base_url=self.api_base, headers={"Authorization": f"Bearer {access_token}"}, timeout=30.0
        )

    @safe_provider_response
    def create_session(self, *, access_token: str) -> ProviderSession:
        _require_token(access_token)
        try:
            with self._http(access_token) as http:
                response = http.post("/sessions")
                response.raise_for_status()
                body = response.json()
        except httpx.HTTPError as error:
            raise ProviderError("Media provider request failed", code="provider_failed") from error
        expires_raw = body.get("expireTime")
        return ProviderSession(
            provider_session_id=body["id"],
            picker_uri=body.get("pickerUri"),
            expires_at=datetime.fromisoformat(expires_raw.replace("Z", "+00:00")) if expires_raw else None,
        )

    @safe_provider_response
    def poll_session(self, *, access_token: str, provider_session_id: str) -> ProviderSessionStatus:
        _require_token(access_token)
        try:
            with self._http(access_token) as http:
                response = http.get(f"/sessions/{provider_session_id}")
                response.raise_for_status()
                body = response.json()
        except httpx.HTTPError as error:
            raise ProviderError("Media provider request failed", code="provider_failed") from error
        return ProviderSessionStatus(ready=bool(body.get("mediaItemsSet", False)))

    @safe_provider_response
    def list_selected_items(self, *, access_token: str, provider_session_id: str) -> list[ProviderMediaItem]:
        _require_token(access_token)
        items: list[ProviderMediaItem] = []
        page_token: str | None = None
        try:
            with self._http(access_token) as http:
                while True:
                    params = {"sessionId": provider_session_id, "pageSize": 100}
                    if page_token:
                        params["pageToken"] = page_token
                    response = http.get("/mediaItems", params=params)
                    response.raise_for_status()
                    body = response.json()
                    for raw in body.get("mediaItems", []):
                        media_file = raw.get("mediaFile", {})
                        create_time = raw.get("createTime")
                        items.append(
                            ProviderMediaItem(
                                provider_item_id=raw["id"],
                                filename=media_file.get("filename", raw["id"]),
                                content_type=media_file.get("mimeType", "application/octet-stream"),
                                captured_at=(
                                    datetime.fromisoformat(create_time.replace("Z", "+00:00")) if create_time else None
                                ),
                            )
                        )
                    page_token = body.get("nextPageToken")
                    if not page_token:
                        break
        except httpx.HTTPError as error:
            raise ProviderError("Media provider request failed", code="provider_failed") from error
        return items

    @safe_provider_response
    def fetch_item(self, *, access_token: str, item: ProviderMediaItem) -> bytes:
        _require_token(access_token)
        # The Picker API media-file record used to build `item` carries a
        # short-lived `baseUrl`; the service layer passes that back to us
        # encoded in `item.provider_item_id`-adjacent lookup, so this method
        # re-lists to fetch a fresh base URL rather than trusting a
        # long-cached one that may have expired between listing and fetch.
        try:
            with self._http(access_token) as http:
                response = http.get(f"/mediaItems/{item.provider_item_id}")
                response.raise_for_status()
                base_url = response.json().get("mediaFile", {}).get("baseUrl")
                if not base_url:
                    raise ProviderError("Media provider request failed", code="provider_failed")
                suffix = "=dv" if item.content_type.startswith("video/") else "=d"
                return download_bounded(http, base_url + suffix)
        except httpx.HTTPError as error:
            raise ProviderError("Media provider request failed", code="provider_failed") from error


class GoProCloudProvider:
    """GoPro Cloud media adapter, gated behind `TRAVEL_GOPRO_CLOUD_ENABLED`.

    GoPro Cloud API beta access is not generally available; every method
    refuses immediately (no network call) while the flag is off, so the rest
    of the import pipeline — and the product overall — stays fully usable
    without it. The endpoint paths below follow the same
    create-session/poll/list/fetch shape as the Google adapter and must be
    finalized against GoPro's beta API documentation once access is granted.
    """

    provider = ImportProvider.GOPRO_CLOUD

    def __init__(self, api_base: str | None = None, client: httpx.Client | None = None) -> None:
        self.api_base = api_base or settings.gopro_cloud_api_base
        self._client = client

    def _ensure_enabled(self) -> None:
        if not settings.gopro_cloud_enabled:
            raise ProviderUnavailableError(
                "GoPro Cloud import is not enabled", code="gopro_cloud_import_is_not_enabled"
            )

    def _http(self, access_token: str) -> httpx.Client:
        return self._client or httpx.Client(
            base_url=self.api_base, headers={"Authorization": f"Bearer {access_token}"}, timeout=30.0
        )

    @safe_provider_response
    def create_session(self, *, access_token: str) -> ProviderSession:
        self._ensure_enabled()
        _require_token(access_token)
        try:
            with self._http(access_token) as http:
                response = http.post("/sessions")
                response.raise_for_status()
                body = response.json()
        except httpx.HTTPError as error:
            raise ProviderError("Media provider request failed", code="provider_failed") from error
        expires_raw = body.get("expireTime")
        return ProviderSession(
            provider_session_id=body["id"],
            picker_uri=body.get("pickerUri"),
            expires_at=datetime.fromisoformat(expires_raw.replace("Z", "+00:00")) if expires_raw else None,
        )

    @safe_provider_response
    def poll_session(self, *, access_token: str, provider_session_id: str) -> ProviderSessionStatus:
        self._ensure_enabled()
        _require_token(access_token)
        try:
            with self._http(access_token) as http:
                response = http.get(f"/sessions/{provider_session_id}")
                response.raise_for_status()
                body = response.json()
        except httpx.HTTPError as error:
            raise ProviderError("Media provider request failed", code="provider_failed") from error
        return ProviderSessionStatus(ready=bool(body.get("mediaItemsSet", False)))

    @safe_provider_response
    def list_selected_items(self, *, access_token: str, provider_session_id: str) -> list[ProviderMediaItem]:
        self._ensure_enabled()
        _require_token(access_token)
        try:
            with self._http(access_token) as http:
                response = http.get("/mediaItems", params={"sessionId": provider_session_id})
                response.raise_for_status()
                body = response.json()
        except httpx.HTTPError as error:
            raise ProviderError("Media provider request failed", code="provider_failed") from error
        items = []
        for raw in body.get("mediaItems", []):
            create_time = raw.get("createTime")
            items.append(
                ProviderMediaItem(
                    provider_item_id=raw["id"],
                    filename=raw.get("filename", raw["id"]),
                    content_type=raw.get("mimeType", "application/octet-stream"),
                    captured_at=(datetime.fromisoformat(create_time.replace("Z", "+00:00")) if create_time else None),
                )
            )
        return items

    @safe_provider_response
    def fetch_item(self, *, access_token: str, item: ProviderMediaItem) -> bytes:
        self._ensure_enabled()
        _require_token(access_token)
        try:
            with self._http(access_token) as http:
                return download_bounded(http, f"/mediaItems/{item.provider_item_id}/download")
        except httpx.HTTPError as error:
            raise ProviderError("Media provider request failed", code="provider_failed") from error


def provider_available(name: ImportProvider) -> bool:
    """Only configured OAuth providers can appear in owner import controls."""
    if name == ImportProvider.GOOGLE_PHOTOS_PICKER:
        return bool(
            settings.google_oauth_client_id
            and settings.google_oauth_client_secret
            and settings.google_oauth_redirect_uri
            and settings.provider_secret_key
        )
    # GoPro's OAuth contract is still unavailable; the beta switch alone is insufficient.
    return False


def provider_for(name: ImportProvider) -> MediaProvider:
    if name == ImportProvider.GOOGLE_PHOTOS_PICKER:
        return GooglePhotosPickerProvider()
    if name == ImportProvider.GOPRO_CLOUD:
        return GoProCloudProvider()
    raise ServiceError("Not an importable provider", code="not_an_importable_provider")


def get_provider_resolver():
    """FastAPI dependency seam: tests override this to hand back fakes so a
    session/poll/list/fetch flow never makes a real HTTP call in CI."""
    return provider_for
