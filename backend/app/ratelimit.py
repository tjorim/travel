"""Rate limiting for the unauthenticated visitor delivery endpoints (#370).

Counters live in this process (``memory://``). Each uvicorn worker keeps its own, so a limit is multiplied by the
worker count; ``backend/Dockerfile`` runs one worker and any change to that must move the counters to shared storage.
"""

import math
import time
from ipaddress import IPv4Address, IPv6Address, ip_address, ip_network

from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from starlette.requests import Request

from .config import settings

UNKNOWN_CLIENT = "unknown"


def _bucket(address: IPv4Address | IPv6Address) -> str:
    if isinstance(address, IPv6Address):
        if address.ipv4_mapped is not None:
            return str(address.ipv4_mapped)
        # A single subscriber usually holds a whole /64, so one address is not a client.
        return str(ip_network(f"{address}/64", strict=False).network_address)
    return str(address)


def get_client_ip(request: Request) -> str:
    """The rate-limit key of a request: the peer, or ``X-Real-IP`` when the peer is a trusted private proxy.

    Caddy reaches the API over the private network, so a private immediate peer is the only one allowed to name the
    visitor. A public peer's ``X-Real-IP`` is ignored, and an unparsable one falls back to the peer. The key is never
    empty because the limiter skips a request whose key is.
    """
    peer = request.client.host if request.client else None
    try:
        peer_address = ip_address(peer) if peer else None
    except ValueError:
        peer_address = None
    if peer_address is None:
        return peer or UNKNOWN_CLIENT
    if peer_address.is_private:
        try:
            return _bucket(ip_address(request.headers.get("x-real-ip", "").strip()))
        except ValueError:
            pass
    return _bucket(peer_address)


def retry_after_seconds(request: Request, error: RateLimitExceeded) -> int:
    """Whole seconds until the window that rejected this request reopens, at least one."""
    try:
        item, args = request.state.view_rate_limit
        reset_at, _remaining = limiter.limiter.get_window_stats(item, *args)
        return max(1, math.ceil(reset_at - time.time()))
    except Exception:
        return max(1, int(error.limit.limit.get_expiry())) if error.limit is not None else 1


limiter = Limiter(key_func=get_client_ip, storage_uri="memory://", enabled=settings.rate_limit_enabled)


def delivery_limit() -> str:
    return settings.rate_limit_default


def shared_link_limit() -> str:
    return settings.rate_limit_shared
