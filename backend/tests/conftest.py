import pytest

from app.ratelimit import limiter


@pytest.fixture(autouse=True)
def _delivery_rate_limit_off():
    # Every test client shares one address, so the visitor limits would otherwise count across unrelated tests.
    # tests/test_rate_limit.py switches them on for its own requests.
    limiter.enabled = False
    limiter.reset()
    yield
    limiter.enabled = False
    limiter.reset()
