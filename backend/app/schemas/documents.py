"""Owner document request and response schemas."""

from datetime import datetime

from pydantic import ConfigDict, Field, model_validator
from pydantic_core import PydanticCustomError

from app.models import DocumentKind
from app.schemas.base import Identifier, InputModel, ResponseModel


def require_unique_document_ids(values: list[str]) -> list[str]:
    if len(values) != len(set(values)):
        raise PydanticCustomError("a_document_can_only_be_attached_once", "A document can only be attached once")
    return values


class DocumentUpdate(InputModel):
    non_nullable_fields = frozenset(["title", "document_kind"])

    title: str | None = Field(default=None, min_length=1, max_length=160)
    document_kind: DocumentKind | None = None
    # The trip the document is filed under; null unfiles it.
    trip_id: Identifier | None = Field(default=None)


class LibraryDocumentUpdate(DocumentUpdate):
    """The body of the deprecated ``PATCH /library/documents/{id}``: ``linked_trip_id`` is the old name of ``trip_id``.

    Omitted keeps the filing, null unfiles, an id files the document under that trip."""

    linked_trip_id: Identifier | None = Field(default=None)

    @model_validator(mode="after")
    def one_trip_value(self):
        if {"trip_id", "linked_trip_id"} <= self.model_fields_set and self.trip_id != self.linked_trip_id:
            raise PydanticCustomError("trip_fields_differ", "trip_id and linked_trip_id name different trips")
        return self

    def as_document_update(self) -> DocumentUpdate:
        fields = self.model_dump(exclude_unset=True)
        if "linked_trip_id" in fields:
            fields["trip_id"] = fields.pop("linked_trip_id")
        return DocumentUpdate.model_validate(fields)


class DocumentResponse(ResponseModel):
    id: str
    document_kind: DocumentKind
    title: str
    byte_size: int
    content_type: str
    original_filename: str | None
    trip_id: str | None
    created_at: datetime
    file_url: str
    model_config = ConfigDict(from_attributes=True)
