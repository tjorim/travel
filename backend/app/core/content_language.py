"""Authored text in two languages, with fallback (#376).

A field a visitor can receive (trip title and summary, update title and body, visit title and summary, route, area
and location labels, photo caption and alt text, collection title) is stored as two nullable columns,
``<field>_nl`` and ``<field>_en``. Neither language is the original. The record's ``content_language`` (a trip's own
column; a trip's records read it from their trip) is the language the plain field name stands for: a write to
``title`` lands in ``title_<content_language>``, and a read of ``title`` is that language's text, else the other's.

``resolve`` is the one rule every surface applies: the requested language, otherwise the other one, otherwise nothing.
Nothing here translates: a language the owner did not write is simply empty.
"""

from enum import StrEnum
from typing import Any

from sqlalchemy import case, func


class ContentLanguage(StrEnum):
    NL = "nl"
    EN = "en"


DEFAULT_LANGUAGE = ContentLanguage.NL
LANGUAGE_VALUES = tuple(language.value for language in ContentLanguage)


def other_language(language: ContentLanguage | str) -> ContentLanguage:
    return ContentLanguage.EN if ContentLanguage(language) == ContentLanguage.NL else ContentLanguage.NL


def pick(nl: str | None, en: str | None, language: ContentLanguage | str) -> tuple[str | None, ContentLanguage | None]:
    """The text to show for ``language`` and the language it is actually in; ``(None, None)`` without any text.

    An empty string counts as missing, so a cleared language falls back to the other."""
    language = ContentLanguage(language)
    texts = {ContentLanguage.NL: nl or None, ContentLanguage.EN: en or None}
    for candidate in (language, other_language(language)):
        if texts[candidate] is not None:
            return texts[candidate], candidate
    return None, None


def resolve(nl: str | None, en: str | None, language: ContentLanguage | str) -> str | None:
    """The requested language's text, otherwise the other language's, otherwise nothing."""
    return pick(nl, en, language)[0]


class Localized:
    """A record's plain field name over its ``<field>_nl`` and ``<field>_en`` columns.

    Read on an instance it is the text in the record's ``content_language``, falling back to the other language
    (``default`` when both are empty). Assigned, it sets the content language's column, which keeps older code that
    names the plain field working. On the class it is a SQL expression with the same rule, for ordering."""

    def __init__(self, default: str | None = None) -> None:
        self.default = default
        self.field = ""

    def __set_name__(self, owner: type, name: str) -> None:
        self.field = name

    def _columns(self, obj: Any) -> tuple[str | None, str | None]:
        return getattr(obj, f"{self.field}_nl"), getattr(obj, f"{self.field}_en")

    def __get__(self, obj: Any, owner: type | None = None) -> Any:
        if obj is None:
            nl, en = (getattr(owner, f"{self.field}_{code}") for code in LANGUAGE_VALUES)
            language = getattr(owner, "content_language", None)
            if hasattr(language, "__clause_element__"):
                return case((language == ContentLanguage.EN.value, func.coalesce(en, nl)), else_=func.coalesce(nl, en))
            return func.coalesce(nl, en)
        text = resolve(*self._columns(obj), obj.content_language or DEFAULT_LANGUAGE)
        return text if text is not None else self.default

    def __set__(self, obj: Any, value: str | None) -> None:
        setattr(obj, f"{self.field}_{obj.content_language or DEFAULT_LANGUAGE}", value or None)
