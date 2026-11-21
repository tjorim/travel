"""Health endpoint schemas, one shape across the apps (liveness, readiness and the summary)."""

from typing import Literal

from app.schemas.base import ResponseModel


class LivenessResponse(ResponseModel):
    """Process-level alive signal; never touches a dependency."""

    status: Literal["alive"]


class ReadinessResponse(ResponseModel):
    """Result of the dependency checks, sent with HTTP 200 (``ready``) or 503 (``not_ready``)."""

    status: Literal["ready", "not_ready"]


class HealthResponse(ResponseModel):
    status: str
    version: str
    commit: str
    liveness_endpoint: str
    readiness_endpoint: str
