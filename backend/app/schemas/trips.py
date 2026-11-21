"""Trip request and response schemas."""

from datetime import date, datetime

from pydantic import ConfigDict, Field, computed_field, model_validator

from app.core.content_language import ContentLanguage
from app.schemas.base import (
    CONTENT_LANGUAGE,
    DUTCH_TEXT,
    ENGLISH_TEXT,
    MARKDOWN,
    PLAIN_TEXT,
    Identifier,
    InputModel,
    ResponseModel,
    _html,
    _html_of,
    require_ordered_dates,
)


class TripCreate(InputModel):
    content_language: ContentLanguage | None = Field(
        default=None,
        description=CONTENT_LANGUAGE + " Left out, it is Dutch (the web app sends the interface language).",
    )
    title: str | None = Field(default=None, max_length=160, description=PLAIN_TEXT)
    title_nl: str | None = Field(default=None, max_length=160, description=DUTCH_TEXT)
    title_en: str | None = Field(default=None, max_length=160, description=ENGLISH_TEXT)
    summary: str | None = Field(default=None, max_length=4000, description=MARKDOWN + " " + PLAIN_TEXT)
    summary_nl: str | None = Field(default=None, max_length=4000, description=MARKDOWN + " " + DUTCH_TEXT)
    summary_en: str | None = Field(default=None, max_length=4000, description=MARKDOWN + " " + ENGLISH_TEXT)
    starts_on: date | None = None
    ends_on: date | None = None

    @model_validator(mode="after")
    def end_not_before_start(self):
        require_ordered_dates(self.starts_on, self.ends_on, "The trip cannot end before it starts")
        return self


class TripUpdate(InputModel):
    non_nullable_fields = frozenset(["content_language", "move_texts"])

    content_language: ContentLanguage | None = Field(default=None, description=CONTENT_LANGUAGE)
    move_texts: bool = Field(
        default=False,
        description="With a changed `content_language`: also move every text of the trip from the old content "
        "language to the new one (for a trip that was entered in the wrong language). Refused while any field has "
        "text in both languages. Not stored.",
    )
    title: str | None = Field(default=None, max_length=160, description=PLAIN_TEXT)
    title_nl: str | None = Field(default=None, max_length=160, description=DUTCH_TEXT)
    title_en: str | None = Field(default=None, max_length=160, description=ENGLISH_TEXT)
    summary: str | None = Field(default=None, max_length=4000, description=MARKDOWN + " " + PLAIN_TEXT)
    summary_nl: str | None = Field(default=None, max_length=4000, description=MARKDOWN + " " + DUTCH_TEXT)
    summary_en: str | None = Field(default=None, max_length=4000, description=MARKDOWN + " " + ENGLISH_TEXT)
    starts_on: date | None = None
    ends_on: date | None = None
    cover_derivative_id: Identifier | None = Field(
        default=None,
        description="The share copy of a photo to use as the trip's cover; null removes the cover. "
        "Choosing a cover does not publish it: an audience shows it only if it already receives that photo.",
    )


class TripBase(ResponseModel):
    id: str
    owner_subject: str
    content_language: ContentLanguage = Field(description=CONTENT_LANGUAGE)
    title: str
    title_nl: str | None
    title_en: str | None
    summary: str | None
    summary_nl: str | None
    summary_en: str | None
    starts_on: date | None
    ends_on: date | None
    cover_derivative_id: str | None = None
    cover_url: str | None = Field(
        default=None,
        description="The owner-only file route of the chosen cover copy, or null; it is not what a visitor receives.",
    )
    model_config = ConfigDict(from_attributes=True)

    @computed_field(description=_html_of("summary"))
    @property
    def summary_html(self) -> str | None:
        return _html(self.summary)


class TripSummaryResponse(TripBase):
    """A trip without any embedded record: what the owner's trip list needs, whatever the trip holds."""

    travel_update_count: int = Field(description="How many travel updates the trip has; read them from its own list.")
    last_update_at: datetime | None = Field(description="The newest ``occurred_at`` among the trip's updates, or null.")


class TripResponse(TripBase):
    """One trip's own fields and cover. Every record kind, travel updates included, has its own list endpoint."""
