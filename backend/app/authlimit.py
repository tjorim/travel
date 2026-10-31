"""Coarse per-client limit on failed bearer-token verification, for the owner API and the MCP route (#46).

Only a token that was checked and refused counts: a forged, malformed, wrongly-signed, expired or wrong-audience
one. A successful request, a request without credentials and an identity-provider outage (signing keys that could
not be fetched) never count. Past the threshold the client's key (the ``ratelimit`` bucket: trusted-proxy
``X-Real-IP`` or the peer, IPv6 grouped by /64) is refused with 429 before any token is parsed, until its window
ends. The counters are fixed windows kept in this process, so each uvicorn worker has its own and the effective
limit is multiplied by the worker count; ``backend/Dockerfile`` runs one worker. Memory is bounded by
``MAX_CLIENTS``.
"""

import math
import time
from threading import Lock

from fastapi import status
from starlette.requests import Request

from .config import settings
from .errors import ApiException
from .ratelimit import get_client_ip

# Distinct clients tracked at once. When full, expired windows go first, then the oldest window.
MAX_CLIENTS = 10_000


class FailedAuthenticationLimiter:
    def __init__(self) -> None:
        self.enabled = True
        self._windows: dict[str, tuple[float, int]] = {}
        self._lock = Lock()

    def _active(self) -> bool:
        return self.enabled and settings.rate_limit_enabled

    def reset(self) -> None:
        with self._lock:
            self._windows.clear()

    def retry_after(self, request: Request) -> int | None:
        """Whole seconds until the client may try again, or None while it is under the threshold."""
        if not self._active():
            return None
        key = get_client_ip(request)
        now = time.monotonic()
        with self._lock:
            window = self._windows.get(key)
            if window is None or now >= window[0] + settings.auth_failure_window_seconds:
                return None
            if window[1] < settings.auth_failure_limit:
                return None
            return max(1, math.ceil(window[0] + settings.auth_failure_window_seconds - now))

    def record_failure(self, request: Request) -> None:
        if not self._active():
            return
        key = get_client_ip(request)
        now = time.monotonic()
        with self._lock:
            window = self._windows.get(key)
            if window is not None and now < window[0] + settings.auth_failure_window_seconds:
                self._windows[key] = (window[0], window[1] + 1)
                return
            # A new window goes last, so dict order is window-start order and eviction takes the oldest.
            self._windows.pop(key, None)
            if len(self._windows) >= MAX_CLIENTS:
                self._evict(now)
            self._windows[key] = (now, 1)

    def _evict(self, now: float) -> None:
        horizon = now - settings.auth_failure_window_seconds
        for key in [key for key, (started, _count) in self._windows.items() if started <= horizon]:
            del self._windows[key]
        while len(self._windows) >= MAX_CLIENTS:
            del self._windows[next(iter(self._windows))]


failed_authentication = FailedAuthenticationLimiter()

THROTTLED_DETAIL = "Too many failed authentication attempts"


def throttled_headers(retry_after: int) -> dict[str, str]:
    return {"Retry-After": str(retry_after), "Cache-Control": "no-store"}


def refuse_throttled_client(request: Request) -> None:
    """Raise the 429 for a client over the threshold; the body carries no token data."""
    retry_after = failed_authentication.retry_after(request)
    if retry_after is not None:
        raise ApiException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            THROTTLED_DETAIL,
            throttled_headers(retry_after),
            code="rate_limited",
        )
