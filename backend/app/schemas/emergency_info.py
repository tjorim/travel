"""Emergency information schemas."""

from datetime import datetime

from pydantic import ConfigDict, Field, computed_field

from app.core.markdown import markdown_text
from app.models import EmergencyInfoKind
from app.schemas.base import MARKDOWN, InputModel, ResponseModel, _html, _html_of


class EmergencyInfoEntryCreate(InputModel):
    kind: EmergencyInfoKind
    label: str = Field(min_length=1, max_length=160)
    value: str = Field(min_length=1, max_length=255)
    notes: str | None = Field(default=None, max_length=4000, description=MARKDOWN)


class EmergencyInfoEntryUpdate(InputModel):
    non_nullable_fields = frozenset(["kind", "label", "value"])

    kind: EmergencyInfoKind | None = None
    label: str | None = Field(default=None, min_length=1, max_length=160)
    value: str | None = Field(default=None, min_length=1, max_length=255)
    notes: str | None = Field(default=None, max_length=4000, description=MARKDOWN)


class EmergencyInfoEntryResponse(ResponseModel):
    id: str
    kind: EmergencyInfoKind
    label: str
    value: str
    notes: str | None
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)

    @computed_field(description=_html_of("notes"))
    @property
    def notes_html(self) -> str | None:
        return _html(self.notes)

    @computed_field(description="The notes as one line of plain text, for the list row. Read-only.")
    @property
    def notes_text(self) -> str | None:
        return markdown_text(self.notes)
