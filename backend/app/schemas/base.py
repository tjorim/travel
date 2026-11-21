"""Shared field types, validators and the two base models every request and response model derives from."""

from datetime import date, time
from typing import Annotated, ClassVar, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, Field, HttpUrl, field_validator
from pydantic_core import PydanticCustomError

from app.core.markdown import render_markdown

COUNTRY_CODE_FIELD = Field(default=None, min_length=2, max_length=2, pattern=r"^[A-Z]{2}$")


MARKDOWN = (
    "Markdown: bold, italic, headings, bulleted, numbered and task lists, links (http, https, mailto), "
    "blockquotes, inline and fenced code, rules and tables. Raw HTML and images are not rendered, and a task "
    "list is display-only: it never creates trip tasks."
)


INLINE_MARKDOWN = (
    "Inline Markdown only: bold, italic and links (http, https, mailto). Headings, lists, other blocks, "
    "raw HTML and images are not rendered."
)


CONTENT_LANGUAGE = (
    "The language a write to a plain text field name lands in (`title` is `title_<content_language>`), and the one "
    "read first: `nl` or `en`. Dutch and English are both always accepted as `<field>_nl` and `<field>_en`; where "
    "one is missing, the other is shown."
)


PLAIN_TEXT = (
    "The text in the record's content language, else the other language's. A write to it sets the content language's "
    "text; null or an empty string clears it."
)


DUTCH_TEXT = "The Dutch text. Null or an empty string clears it; a visitor who reads Dutch gets this one."


ENGLISH_TEXT = "The English text. Null or an empty string clears it; a visitor who reads English gets this one."


LOCAL_NAME = (
    "The name of the place as written where it is (for example `東京` or `Αθήνα`): not a translation of the label, "
    "and often not in Latin script. Used for search and navigation, and shown beside the label wherever the label "
    "is shared; never shared without one. Null or an empty string clears it."
)


def blank_to_none(value: str | None) -> str | None:
    """A name that is only whitespace is no name: it clears the field, like an empty string."""
    return (value.strip() or None) if isinstance(value, str) else value


def _html(source: str | None) -> str | None:
    """The owner app's sanitized HTML for one Markdown field (see ``app.core.markdown``)."""
    return render_markdown(source, "owner")


def _html_of(field: str) -> str:
    return f"Sanitized HTML rendered from the Markdown `{field}`; null without text. Read-only."


def require_https(value: HttpUrl | None) -> HttpUrl | None:
    if value is not None and value.scheme != "https":
        raise PydanticCustomError("links_must_use_https", "Links must use HTTPS")
    return value


def require_timezone(value: str | None) -> str | None:
    """Accept only a known IANA zone name such as ``Asia/Taipei``."""
    if value is None:
        return value
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError) as error:
        raise PydanticCustomError("unknown_time_zone", "Unknown time zone") from error
    return value


def require_ordered_dates(start: date | None, end: date | None, message: str) -> None:
    if start is not None and end is not None and end < start:
        raise PydanticCustomError("dates_out_of_order", message)  # ty: ignore[invalid-argument-type]


def require_safe_text(value):
    """Reject characters PostgreSQL cannot store before any lookup or rendering."""
    if isinstance(value, str) and ("\x00" in value or any(0xD800 <= ord(c) <= 0xDFFF for c in value)):
        raise PydanticCustomError("unsafe_text", "Text must not contain NUL or surrogate characters")
    if isinstance(value, list):
        for item in value:
            require_safe_text(item)
    return value


SafeText = Annotated[str, BeforeValidator(require_safe_text)]


DocumentTitle = Annotated[SafeText, Field(min_length=1, max_length=160)]


Identifier = Annotated[SafeText, Field(min_length=1, max_length=32)]


def require_local_time(value: time) -> time:
    if value.tzinfo is not None:
        raise PydanticCustomError("local_time_required", "Use a local clock time without a UTC offset")
    return value


LocalTime = Annotated[time, AfterValidator(require_local_time)]


class InputModel(BaseModel):
    """A payload a client sends: an unknown field is rejected, never silently dropped.

    A misspelled or guessed field would otherwise succeed without storing anything,
    so the caller would believe the change was applied."""

    model_config = ConfigDict(extra="forbid")
    # Omission keeps the stored value; explicit null cannot clear these fields.
    non_nullable_fields: ClassVar[frozenset[str]] = frozenset()

    @field_validator("*", mode="before")
    @classmethod
    def safe_input(cls, value, info):
        require_safe_text(value)
        if value is None and info.field_name in cls.non_nullable_fields:
            raise PydanticCustomError("field_may_not_be_null", "This field may not be null")
        return value


class ResponseModel(BaseModel):
    """A record the API answers with. A field with a default is always sent, so the schema lists it as required
    and the generated client types never make it optional. (Only a field that is left out when it has no value,
    such as those of a visitor projection, is optional in the schema.)"""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)


PRECISION_OWN = (
    "How precisely a visitor may read this record's dates: day, month or year. null (the default) follows the "
    "audience: each public view and hidden link sets its own date precision in its share scope "
    "(defaults.date_precision). The coarser of the two always applies, so a visitor never gets a finer date than "
    "either allows; with neither set the date reads by month."
)


TextLanguage = Literal["nl", "en"]


LANGUAGE_MARKER = (
    "Present only when this text is in the other language because the one the visitor asked for is empty: "
    "`nl` or `en`, so the page can set `lang` on the element."
)
