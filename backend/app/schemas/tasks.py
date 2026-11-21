"""Trip task and task alert schemas."""

from datetime import date, datetime

from pydantic import AwareDatetime, ConfigDict, Field, HttpUrl, computed_field, field_validator

from app.models import TaskAlertKind
from app.schemas.base import MARKDOWN, InputModel, ResponseModel, _html, _html_of, require_https


class TaskLink(InputModel):
    label: str = Field(min_length=1, max_length=80)
    url: HttpUrl

    _https = field_validator("url")(require_https)


class StoredTaskLink(TaskLink):
    """A saved link as a response reads it back: stored data is not rejected for an extra key."""

    model_config = ConfigDict(extra="ignore")


class TripTaskCreate(InputModel):
    title: str = Field(min_length=1, max_length=160)
    notes: str | None = Field(default=None, max_length=4000, description=MARKDOWN)
    due_date: date | None = None
    remind_at: AwareDatetime | None = None
    links: list[TaskLink] = Field(default_factory=list, max_length=5)


class TripTaskUpdate(InputModel):
    non_nullable_fields = frozenset(["title", "links", "completed"])

    title: str | None = Field(default=None, min_length=1, max_length=160)
    notes: str | None = Field(default=None, max_length=4000, description=MARKDOWN)
    due_date: date | None = None
    remind_at: AwareDatetime | None = None
    links: list[TaskLink] | None = Field(default=None, max_length=5)
    completed: bool | None = None


class TripTaskResponse(ResponseModel):
    id: str
    title: str
    notes: str | None
    due_date: date | None
    remind_at: datetime | None
    reminded_at: datetime | None
    links: list[StoredTaskLink]
    completed_at: datetime | None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

    @computed_field(description=_html_of("notes"))
    @property
    def notes_html(self) -> str | None:
        return _html(self.notes)


class TripTaskAlertResponse(ResponseModel):
    id: str
    task_id: str
    kind: TaskAlertKind
    title: str
    scheduled_for: datetime
    created_at: datetime
    read_at: datetime | None
    email_sent_at: datetime | None
    email_attempts: int
    email_last_error: str | None
    model_config = ConfigDict(from_attributes=True)
