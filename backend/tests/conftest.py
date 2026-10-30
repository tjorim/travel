import os

import pytest

# Configure development before importing application modules: production startup
# deliberately refuses the public development share-link secret.
os.environ["TRAVEL_ENVIRONMENT"] = "development"

from app.ratelimit import limiter  # noqa: E402


@pytest.fixture(autouse=True)
def _delivery_rate_limit_off():
    # Every test client shares one address, so the visitor limits would otherwise count across unrelated tests.
    # tests/test_rate_limit.py switches them on for its own requests.
    limiter.enabled = False
    limiter.reset()
    yield
    limiter.enabled = False
    limiter.reset()
