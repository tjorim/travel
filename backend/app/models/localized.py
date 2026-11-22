"""Owner metadata for bilingual text."""

from datetime import UTC, datetime
from typing import ClassVar, Literal, TypedDict

from app.core.content_language import LANGUAGE_VALUES


class FreshnessValues(TypedDict):
    nl_updated_at: datetime | None
    en_updated_at: datetime | None
    possibly_out_of_date: Literal["nl", "en"] | None


class LocalizedRecord:
    localized_fields: ClassVar[tuple[str, ...]]

    def text_timestamp(self, field: str, language: str) -> datetime | None:
        value: datetime | None = getattr(self, f"{field}_{language}_updated_at")
        # SQLite returns naive datetimes for timezone-aware columns; writes are always UTC.
        return value.replace(tzinfo=UTC) if value is not None and value.tzinfo is None else value

    @property
    def translation_freshness(self) -> dict[str, FreshnessValues]:
        freshness: dict[str, FreshnessValues] = {}
        for field in self.localized_fields:
            nl_at, en_at = (self.text_timestamp(field, code) for code in LANGUAGE_VALUES)
            stale = None
            if getattr(self, f"{field}_nl") and getattr(self, f"{field}_en") and nl_at != en_at:
                stale = "nl" if nl_at is None or (en_at is not None and nl_at < en_at) else "en"
            freshness[field] = {
                "nl_updated_at": nl_at,
                "en_updated_at": en_at,
                "possibly_out_of_date": stale,
            }
        return freshness
