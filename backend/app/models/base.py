"""Shared ORM helpers: the opaque id, column factories and the trip-language lookup."""

from __future__ import annotations

import uuid
from enum import StrEnum

from sqlalchemy import CheckConstraint, Enum, String
from sqlalchemy.orm import mapped_column

from app.core.content_language import DEFAULT_LANGUAGE
from app.models.enums import Visibility


def opaque_id() -> str:
    return uuid.uuid4().hex


# SQLAlchemy Integer is a signed 32-bit column on PostgreSQL.
INTEGER_MAX = 2**31 - 1


def _code(codes: type[StrEnum], value: object) -> str:
    """Check a code against its list when a row is written and store it as a plain string."""
    try:
        return codes(value).value
    except ValueError:
        raise ValueError(f"Unknown {codes.__name__} code: {value!r}") from None


def _enum_column(enum_cls: type[StrEnum], name: str):
    return Enum(enum_cls, name=name, values_callable=lambda enum: [member.value for member in enum])


def _visibility_column():
    """A record's audience choice; ``private`` until the owner decides."""
    return mapped_column(_enum_column(Visibility, "travel_visibility"), default=Visibility.PRIVATE, nullable=False)


def _content_language_column():
    """The language a write to a plain text field name lands in (``nl`` or ``en``); see ``app.core.content_language``."""
    return mapped_column(
        String(2), default=DEFAULT_LANGUAGE.value, server_default=DEFAULT_LANGUAGE.value, nullable=False
    )


def _trip_language(record) -> str:
    """The content language of the trip a record belongs to (the default while it has no trip loaded yet)."""
    trip = record.trip
    return trip.content_language if trip is not None and trip.content_language else DEFAULT_LANGUAGE.value


def _languages(*fields: str) -> tuple[CheckConstraint, ...]:
    """One check per required text field (``table.field``): it is written in at least one language."""
    return tuple(
        CheckConstraint(f"{field}_nl IS NOT NULL OR {field}_en IS NOT NULL", name=f"ck_{table}_{field}_present")
        for table, field in (item.split(".") for item in fields)
    )
