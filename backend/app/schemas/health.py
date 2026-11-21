"""Health endpoint schema."""

from app.schemas.base import ResponseModel


class HealthResponse(ResponseModel):
    status: str
    version: str
    commit: str
