"""MCP capability manifest schemas."""

from typing import Literal

from pydantic import Field

from app.schemas.base import ResponseModel


class McpToolCapability(ResponseModel):
    name: str
    effect: Literal["read", "write"]
    requires_confirmation: bool
    access: dict[str, str] = Field(description="Empty: Travel has one owner-only policy.")


class McpCapabilitiesResponse(ResponseModel):
    contract_version: int
    enabled: bool
    mount_path: str
    version: str | None
    tools: list[McpToolCapability]
    visible_tools: list[str]
    resources: list[str]
    prompts: list[str]
