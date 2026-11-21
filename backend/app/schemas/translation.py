"""Draft translation request and response schemas."""

from typing import Literal

from pydantic import Field, model_validator
from pydantic_core import PydanticCustomError

from app.schemas.base import InputModel, ResponseModel

TranslationLanguage = Literal["nl", "en"]


class TranslationDraftRequest(InputModel):
    """Owner-only request for a machine-translated draft of one field's text."""

    # At about 170 characters/s plus a 15-30 s cold start, this stays under the
    # 100 s a proxied Cloudflare request may stay open (the request is held open).
    text: str = Field(min_length=1, max_length=8000)
    source: TranslationLanguage
    target: TranslationLanguage

    @model_validator(mode="after")
    def languages_differ(self) -> TranslationDraftRequest:
        if self.source == self.target:
            raise PydanticCustomError("translation_languages_must_differ", "Choose two different languages")
        return self


class TranslationDraftResponse(ResponseModel):
    text: str = Field(description="The translated draft. Nothing is stored; the owner reviews and edits it.")
    source: TranslationLanguage
    target: TranslationLanguage
    machine_translated: Literal[True] = True
