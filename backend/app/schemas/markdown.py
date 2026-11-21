"""Markdown preview request and response schemas."""

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.base import InputModel


class MarkdownRenderRequest(InputModel):
    """Owner-only preview of one field, rendered exactly as the stored field will be."""

    source: str = Field(max_length=10000)
    format: Literal["markdown", "inline", "contact"] = Field(
        default="markdown",
        description="markdown for long-form fields, inline for a media caption, contact for a stay's contact details.",
    )


class MarkdownRenderResponse(BaseModel):
    html: str | None = Field(description="Sanitized HTML; null without text.")
    text: str | None = Field(description="The source as one line of plain text; null without text.")
