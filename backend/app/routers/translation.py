"""Owner-only draft translation: a request that only ever suggests, never saves."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request, status

from ..auth import current_subject
from ..errors import ApiException, service_exception
from ..schemas import TranslationDraftRequest, TranslationDraftResponse
from ..translation import TranslationCancelled, TranslationError, TranslationService, get_translation_service

router = APIRouter(prefix="/translation", tags=["translation"])

SubjectDep = Annotated[str, Depends(current_subject)]
ServiceDep = Annotated[TranslationService, Depends(get_translation_service)]

# nginx's status for a caller that stopped waiting; nobody reads this response.
_CLIENT_CLOSED_REQUEST = 499


@router.post("/drafts", response_model=TranslationDraftResponse)
async def translate_draft(
    payload: TranslationDraftRequest, request: Request, _: SubjectDep, service: ServiceDep
) -> TranslationDraftResponse:
    # Stateless: the draft is returned to the owner and neither it nor its
    # source is stored, logged or audited.
    try:
        text = await service.translate(payload.text, payload.source, payload.target, cancelled=request.is_disconnected)
    except TranslationCancelled:
        raise ApiException(_CLIENT_CLOSED_REQUEST, "Translation cancelled", code="translation_cancelled") from None
    except TranslationError as error:
        raise service_exception(status.HTTP_503_SERVICE_UNAVAILABLE, error) from error
    return TranslationDraftResponse(text=text, source=payload.source, target=payload.target)
