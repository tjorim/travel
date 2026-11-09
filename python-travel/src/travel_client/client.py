"""Bounded, non-retrying owner API transport compatible with HA aiohttp sessions."""

import asyncio
import json
import math
import re
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Self, TypeVar, Unpack, cast
from urllib.parse import urlsplit

import aiohttp
from pydantic import TypeAdapter, ValidationError

from .errors import AuthenticationError, ProtocolError, RateLimitError, TransportError, TravelError
from .models import (
    Identity,
    LiveSession,
    Operation,
    PackingItem,
    PackingItemFields,
    PackingItemUpdate,
    PackingList,
    PositionResult,
    Task,
    TaskFields,
    TaskUpdate,
    Trip,
)

T = TypeVar("T")
TokenSupplier = Callable[[], Awaitable[str]]
MAX_RESPONSE_BYTES = 2 * 1024 * 1024


def _id(value: str) -> str:
    # IDs are opaque single path segments, never caller-provided URLs/paths.
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value):
        raise ValueError("Invalid record ID")
    return value


def _retry_after(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        seconds = float(value)
    except ValueError:
        try:
            seconds = (parsedate_to_datetime(value) - datetime.now(UTC)).total_seconds()
        except ValueError, TypeError, OverflowError:
            return None
    return max(0, seconds) if math.isfinite(seconds) else None


class TravelClient:
    def __init__(
        self,
        base_url: str,
        token_supplier: TokenSupplier,
        *,
        session: aiohttp.ClientSession | None = None,
        timeout: float = 15,
    ):
        url = urlsplit(base_url)
        if (
            url.scheme not in {"https", "http"}
            or not url.hostname
            or url.username is not None
            or url.password is not None
            or url.query
            or url.fragment
            or url.path not in {"", "/"}
            or (url.scheme == "http" and url.hostname not in {"localhost", "127.0.0.1", "::1"})
        ):
            raise ValueError("Use an HTTPS origin (HTTP is allowed only on loopback)")
        if not math.isfinite(timeout) or timeout <= 0:
            raise ValueError("Timeout must be finite and positive")
        self._origin = base_url.rstrip("/")
        self._token_supplier = token_supplier
        self._session = session
        self._owned = session is None
        self._timeout = timeout

    async def __aenter__(self) -> Self:
        if self._owned and self._session is None:
            self._session = aiohttp.ClientSession(cookie_jar=aiohttp.DummyCookieJar(), trust_env=False)
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.close()

    async def close(self) -> None:
        if self._owned and self._session is not None:
            await self._session.close()
            self._session = None

    async def _request(self, method: Operation, path: str, model: type[T], payload: object = None) -> T:
        if self._session is None:
            raise RuntimeError("Use async with for a library-owned session")
        write = method != "GET"
        failure: TravelError | None = None
        try:
            async with asyncio.timeout(self._timeout):
                try:
                    token = await self._token_supplier()
                    if not isinstance(token, str) or not token or any(c.isspace() for c in token):
                        raise ValueError
                except Exception:  # noqa: BLE001 - supplier failures must not leak credentials
                    failure = AuthenticationError("token_unavailable")
                if failure is None:
                    async with self._session.request(
                        method,
                        self._origin + "/api/" + path,
                        headers={
                            "Authorization": "Bearer " + token,
                            "Accept": "application/json",
                            "Accept-Encoding": "identity",
                        },
                        json=payload,
                        allow_redirects=False,
                        auto_decompress=False,
                        timeout=aiohttp.ClientTimeout(total=self._timeout),
                        raise_for_status=False,
                    ) as response:
                        if response.status == 401:
                            failure = AuthenticationError("authentication_required", status=401)
                        elif response.status == 429:
                            failure = RateLimitError(_retry_after(response.headers.get("Retry-After")))
                        else:
                            data = bytearray()
                            async for chunk in response.content.iter_chunked(65536):
                                data.extend(chunk)
                                if len(data) > MAX_RESPONSE_BYTES:
                                    failure = ProtocolError("response_too_large", ambiguous=write)
                                    break
                            if failure is None:
                                if response.status == 204:
                                    if model is not type(None):
                                        failure = ProtocolError("invalid_response", ambiguous=write)
                                    else:
                                        return cast(T, None)
                                else:
                                    try:
                                        body = json.loads(data)
                                    except ValueError, UnicodeError:
                                        body = None
                                    if not 200 <= response.status < 300:
                                        code = "http_error"
                                        if isinstance(body, dict):
                                            errors = body.get("errors")
                                            if isinstance(errors, list) and errors and isinstance(errors[0], dict):
                                                candidate = errors[0].get("code")
                                                if isinstance(candidate, str) and re.fullmatch(
                                                    r"[a-z_]{1,100}", candidate
                                                ):
                                                    code = candidate
                                        failure = TravelError(
                                            code, status=response.status, ambiguous=write and response.status >= 500
                                        )
                                    else:
                                        try:
                                            return TypeAdapter(model).validate_python(body)
                                        except ValidationError:
                                            failure = ProtocolError("invalid_response", ambiguous=write)
        except TimeoutError:
            failure = TransportError("timeout", ambiguous=write)
        except aiohttp.ClientError:
            failure = TransportError("connection_failed", ambiguous=write)
        # Raise outside handlers: no exception chain retaining credential-bearing aiohttp errors.
        assert failure is not None
        raise failure

    async def identity(self) -> Identity:
        return await self._request("GET", "identity", Identity)

    async def trips(self) -> list[Trip]:
        return await self._request("GET", "trips", list[Trip])

    async def select_trip(self, trip_id: str) -> SelectedTrip:
        trip_id = _id(trip_id)
        await self._request("GET", "trips/" + trip_id, Trip)
        return SelectedTrip(self, trip_id)


class SelectedTrip:
    """Explicit trip scope; IDs from another trip are still checked by the server."""

    def __init__(self, client: TravelClient, trip_id: str):
        self._client = client
        self.trip_id = _id(trip_id)

    async def _request(self, method: Operation, suffix: str, model: type[T], payload: object = None) -> T:
        return await self._client._request(method, f"trips/{self.trip_id}/{suffix}", model, payload)

    async def live_sessions(self) -> list[LiveSession]:
        return await self._request("GET", "live-location", list[LiveSession])

    async def push_position(
        self, session_id: str, *, observed_at: datetime, latitude: float, longitude: float
    ) -> PositionResult:
        if observed_at.tzinfo is None or not math.isfinite(latitude) or not math.isfinite(longitude):
            raise ValueError("Invalid position")
        return await self._request(
            "POST",
            "live-location/" + _id(session_id) + "/positions",
            PositionResult,
            {
                "observed_at": observed_at.isoformat(),
                "latitude": latitude,
                "longitude": longitude,
            },
        )

    async def tasks(self) -> list[Task]:
        return await self._request("GET", "trip-tasks", list[Task])

    async def create_task(self, title: str, **fields: Unpack[TaskFields]) -> Task:
        return await self._request("POST", "trip-tasks", Task, {"title": title, **fields})

    async def update_task(self, task_id: str, changes: TaskUpdate) -> Task:
        return await self._request("PATCH", "trip-tasks/" + _id(task_id), Task, changes)

    async def complete_task(self, task_id: str) -> Task:
        return await self.update_task(task_id, {"completed": True})

    async def reopen_task(self, task_id: str) -> Task:
        return await self.update_task(task_id, {"completed": False})

    async def delete_task(self, task_id: str) -> None:
        await self._request("DELETE", "trip-tasks/" + _id(task_id), type(None))

    async def packing_lists(self) -> list[PackingList]:
        return await self._request("GET", "packing-lists", list[PackingList])

    async def create_packing_list(self, name: str) -> PackingList:
        return await self._request("POST", "packing-lists", PackingList, {"name": name})

    async def update_packing_list(self, list_id: str, name: str) -> PackingList:
        return await self._request("PATCH", "packing-lists/" + _id(list_id), PackingList, {"name": name})

    async def delete_packing_list(self, list_id: str) -> None:
        await self._request("DELETE", "packing-lists/" + _id(list_id), type(None))

    async def packing_items(self, list_id: str) -> list[PackingItem]:
        return await self._request("GET", f"packing-lists/{_id(list_id)}/items", list[PackingItem])

    async def create_packing_item(self, list_id: str, label: str, **fields: Unpack[PackingItemFields]) -> PackingItem:
        return await self._request(
            "POST", f"packing-lists/{_id(list_id)}/items", PackingItem, {"label": label, **fields}
        )

    async def update_packing_item(self, list_id: str, item_id: str, changes: PackingItemUpdate) -> PackingItem:
        return await self._request("PATCH", f"packing-lists/{_id(list_id)}/items/{_id(item_id)}", PackingItem, changes)

    async def complete_packing_item(self, list_id: str, item_id: str) -> PackingItem:
        return await self.update_packing_item(list_id, item_id, {"packed": True})

    async def reopen_packing_item(self, list_id: str, item_id: str) -> PackingItem:
        return await self.update_packing_item(list_id, item_id, {"packed": False})

    async def delete_packing_item(self, list_id: str, item_id: str) -> None:
        await self._request("DELETE", f"packing-lists/{_id(list_id)}/items/{_id(item_id)}", type(None))
