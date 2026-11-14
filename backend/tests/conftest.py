import os

import pytest

# Configure development before importing application modules: production startup
# deliberately refuses the public development share-link secret.
os.environ["TRAVEL_ENVIRONMENT"] = "development"

from app.authlimit import failed_authentication  # noqa: E402
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


@pytest.fixture(autouse=True)
def _failed_authentication_limit_off():
    # Tests that forge many tokens from one address would otherwise trip the limit; tests/test_auth_limit.py enables it.
    failed_authentication.enabled = False
    failed_authentication.reset()
    yield
    failed_authentication.enabled = False
    failed_authentication.reset()


@pytest.fixture(autouse=True)
def _pillow_rejects_truncated_images():
    # WeasyPrint sets ImageFile.LOAD_TRUNCATED_IMAGES on import. The API runs the renderer in a subprocess, so it
    # never reaches the application, but a test that imports app.pdf_renderer would leak it into every later test.
    from PIL import ImageFile

    ImageFile.LOAD_TRUNCATED_IMAGES = False
    yield
    ImageFile.LOAD_TRUNCATED_IMAGES = False
