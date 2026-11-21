"""Owner identity schema."""

from app.schemas.base import ResponseModel


class OwnerIdentityResponse(ResponseModel):
    subject: str
    contract_version: int
    capabilities: list[str]
