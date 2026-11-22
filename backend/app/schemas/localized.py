"""Freshness metadata exposed to the owner."""

from datetime import datetime

from .base import ResponseModel, TextLanguage


class TranslationFreshness(ResponseModel):
    nl_updated_at: datetime | None
    en_updated_at: datetime | None
    possibly_out_of_date: TextLanguage | None
