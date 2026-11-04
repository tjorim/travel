"""Visitor limits: public trips and unlisted links have separate shared buckets."""

from limits import parse_many
from starlette.requests import Request

from .config import settings
from .request_limits import RateLimitExceeded, RequestRateLimiter
from .request_limits import get_client_ip as get_client_ip

limiter = RequestRateLimiter(settings.rate_limit_default, enabled=settings.rate_limit_enabled)


def retry_after_seconds(request: Request, error: RateLimitExceeded) -> int:
    return int(error.rate_headers["Retry-After"])


async def public_delivery_limit(request: Request) -> None:
    limiter.limits = parse_many(settings.rate_limit_default)
    limiter.check(request, scope="public-trip")


async def shared_delivery_limit(request: Request) -> None:
    limiter.limits = parse_many(settings.rate_limit_shared)
    limiter.check(request, scope="shared-link")
