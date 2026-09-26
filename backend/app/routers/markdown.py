"""The owner app's Markdown preview: the same renderer as the stored fields."""

from typing import Annotated

from fastapi import APIRouter, Depends

from ..auth import current_subject
from ..markdown import markdown_text, render
from ..schemas import MarkdownRenderRequest, MarkdownRenderResponse

router = APIRouter(prefix="/markdown", tags=["markdown"])


@router.post("/render", response_model=MarkdownRenderResponse)
def render_preview(
    payload: MarkdownRenderRequest, _: Annotated[str, Depends(current_subject)]
) -> MarkdownRenderResponse:
    # Stateless: nothing is stored, and the source never leaves this response.
    return MarkdownRenderResponse(
        html=render(payload.source, payload.format, "owner"), text=markdown_text(payload.source, payload.format)
    )
