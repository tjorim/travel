"""Health endpoints, with the same shape in every app.

- ``GET /api/health/liveness``: the process answers; no dependency is touched.
- ``GET /api/health/readiness``: the database (and, when configured, the OIDC signing keys) answer; 503 otherwise.
- ``GET /api/health``: version and commit, with the two probe paths. It also checks the database and answers 503 when
  it is unavailable, which is what the image's ``HEALTHCHECK`` relies on.
"""

import logging
import threading
import time
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import ApiException
from app.db.session import SessionLocal, get_session
from app.schemas import HealthResponse, LivenessResponse, ReadinessResponse
from app.version import APP_COMMIT, APP_VERSION

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])

SessionDep = Annotated[Session, Depends(get_session)]

LIVENESS_PATH = "/api/health/liveness"
READINESS_PATH = "/api/health/readiness"

# Probes are polled every few seconds: a reachable identity provider is remembered briefly so they do not each cost a
# request. A failure is never cached, so recovery shows on the next probe.
JWKS_PROBE_TIMEOUT_SECONDS = 3.0
JWKS_PROBE_CACHE_SECONDS = 30.0
_jwks_reachable_until = 0.0
_jwks_lock = threading.Lock()


def _jwks_reachable() -> bool:
    global _jwks_reachable_until
    if not settings.oidc_jwks_url:
        return True
    with _jwks_lock:
        if time.monotonic() < _jwks_reachable_until:
            return True
        try:
            response = httpx.get(settings.oidc_jwks_url, timeout=JWKS_PROBE_TIMEOUT_SECONDS)
            response.raise_for_status()
        except httpx.HTTPError:
            logger.warning("Readiness check failed: the OIDC signing keys are unreachable")
            return False
        _jwks_reachable_until = time.monotonic() + JWKS_PROBE_CACHE_SECONDS
        return True


@router.get("/health/liveness", response_model=LivenessResponse)
def liveness() -> dict[str, str]:
    return {"status": "alive"}


@router.get(
    "/health/readiness",
    response_model=ReadinessResponse,
    responses={status.HTTP_503_SERVICE_UNAVAILABLE: {"model": ReadinessResponse}},
)
def readiness(response: Response, session: SessionDep) -> dict[str, str]:
    try:
        if session.get_bind().dialect.name == "postgresql":
            session.execute(text("SET LOCAL statement_timeout = '2000'"))
        session.execute(text("SELECT 1"))
    except Exception:
        logger.exception("Readiness check failed: database connectivity error")
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "not_ready"}
    if not _jwks_reachable():
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "not_ready"}
    return {"status": "ready"}


@router.get("/health", response_model=HealthResponse)
def health() -> dict[str, str]:
    try:
        with SessionLocal() as session:
            session.execute(text("SELECT 1"))
    except Exception as error:
        raise ApiException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database unavailable", code="database_unavailable"
        ) from error
    return {
        "status": "ok",
        "version": APP_VERSION,
        "commit": APP_COMMIT,
        "liveness_endpoint": LIVENESS_PATH,
        "readiness_endpoint": READINESS_PATH,
    }
