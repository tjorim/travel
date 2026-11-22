"""Writing authored text that exists in Dutch and English (#376; see ``app.core.content_language``).

A payload names a text field three ways: ``title_nl``, ``title_en`` and the plain ``title``. Alone, the plain name
is a write to the record's content language, so a client that knows one language (the Home Assistant integration, an
older script) keeps working. Next to the content language's own non-empty field, that field decides and only a
plain value that contradicts it is refused; otherwise the plain name is still that write, except that the text
already read as the plain name (a record sent back as it was read) is left alone. A suggestion the owner edits (an
area name from the place search, sent back with only `label` changed and empty language fields) therefore saves.
An omitted field keeps its text; ``null`` or an empty string clears one language."""

from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import case, select, update
from sqlalchemy.orm import Session

from app.core.content_language import DEFAULT_LANGUAGE, LANGUAGE_VALUES, ContentLanguage, resolve
from app.core.errors import Refusal

from ..models import Area, Location, MediaDerivative, Route, TravelUpdate, Trip, Visit
from ..models.localized import LocalizedRecord


def _cleared(value: str | None) -> str | None:
    return value or None


def write_text(
    record: LocalizedRecord,
    field: str,
    payload: Any,
    language: str,
    *,
    required: bool = False,
    label: str | None = None,
) -> bool:
    """Apply localized text and review fields; true when text or freshness metadata changed.

    ``language`` is the record's content language. ``required`` refuses a write that leaves neither language
    with text. A plain value that disagrees with the content language's own column is refused rather than
    resolved by guessing which one the caller meant."""
    given = payload.model_fields_set
    texts = {code: getattr(record, f"{field}_{code}") for code in LANGUAGE_VALUES}
    before = dict(texts)
    for code in LANGUAGE_VALUES:
        if f"{field}_{code}" in given:
            texts[code] = _cleared(getattr(payload, f"{field}_{code}"))
    if field in given:
        plain = _cleared(getattr(payload, field))
        own = f"{field}_{language}"
        explicit = any(f"{field}_{code}" in given for code in LANGUAGE_VALUES)
        if own in given and texts[language] is not None:
            if plain is not None and texts[language] != plain:
                # The plain name next to the same language's own field with other text: refuse, never guess.
                raise Refusal(
                    f"{field} and {own} are the same language and differ; send one of them",
                    code="localized_text_conflict",
                    params={"language": language},
                    field=field,
                )
            # The same text twice: nothing more to write.
        elif not explicit or (plain is not None and plain != resolve(*before.values(), language)):
            # Alone, or next to fields that leave the content language empty: a write to the content language,
            # unless it is the text already read there (a record sent back as it was read, whose plain name
            # fell back to the other language).
            texts[language] = plain
    if required and not any(texts.values()):
        raise Refusal(
            f"{label or field} needs text in Dutch or English", code="text_required_in_a_language", field=field
        )
    timestamps = {code: record.text_timestamp(field, code) for code in LANGUAGE_VALUES}
    latest = max((stamp for stamp in timestamps.values() if stamp is not None), default=None)
    now = datetime.now(UTC)
    if latest is not None and now <= latest:
        now = latest + timedelta(microseconds=1)
    for code, value in texts.items():
        if value != before[code]:
            setattr(record, f"{field}_{code}", value)
            setattr(record, f"{field}_{code}_updated_at", now)
            timestamps[code] = now

    # A review catches up to the other version without making that version appear stale in turn.
    reviewed = getattr(payload, f"{field}_reviewed", None)
    if reviewed is not None and all(texts.values()):
        other = next(code for code in LANGUAGE_VALUES if code != reviewed)
        own_at, other_at = timestamps[reviewed], timestamps[other]
        if other_at is not None and (own_at is None or own_at < other_at):
            setattr(record, f"{field}_{reviewed}_updated_at", other_at)
            return True
    return texts != before


def trip_language(session: Session, trip_id: str) -> str:
    """The content language of a trip (its row is normally already loaded in the session)."""
    trip = session.get(Trip, trip_id)
    return trip.content_language if trip is not None else DEFAULT_LANGUAGE.value


def text_keys(*fields: str) -> set[str]:
    """Payload keys handled by the localized writer, including review confirmations."""
    return {
        key
        for field in fields
        for key in (field, f"{field}_reviewed", *(f"{field}_{code}" for code in LANGUAGE_VALUES))
    }


def write_texts(
    record: LocalizedRecord, fields: Iterable[str], payload: Any, language: str, *, required: Iterable[str] = ()
) -> bool:
    """``write_text`` for several fields; true when any text or freshness metadata changed."""
    needed = set(required)
    changed = False
    for field in fields:  # every field is written: no short-circuit
        changed = write_text(record, field, payload, language, required=field in needed) or changed
    return changed


# The text a trip's records hold, by table: moved as a whole when the trip changes its content language.
TRIP_TEXTS: tuple[tuple[Any, tuple[str, ...]], ...] = (
    (Trip, ("title", "summary")),
    (Area, ("label",)),
    (Location, ("label",)),
    (Visit, ("title", "summary")),
    (Route, ("label",)),
    (TravelUpdate, ("title", "body")),
    (MediaDerivative, ("caption", "alt_text")),
)


def move_texts(session: Session, trip_id: str, source: ContentLanguage, target: ContentLanguage) -> None:
    """Move every text a trip's records hold in ``source`` into ``target`` (the owner wrote it in the other language).

    Only text that has no counterpart in ``target`` moves, and a field that has both languages refuses the whole
    move (``trip_text_in_both_languages``; the caller's transaction is rolled back, so nothing is half moved).

    Each row moves in one statement that reads and writes its own current values, so a translation another
    transaction commits meanwhile is kept, never overwritten: a row that has both languages by the time its update
    runs is left alone, and the check after the updates (which sees every committed write) refuses the move. The
    callers that write localized text hold the trip row lock (``owned_trip(lock=True)``), so this normally
    waits for none of them."""
    for model, fields in TRIP_TEXTS:
        scope = model.id == trip_id if model is Trip else model.trip_id == trip_id
        values = {}
        for field in fields:
            source_column, target_column = (getattr(model, f"{field}_{code}") for code in (source.value, target.value))
            free = target_column.is_(None) & source_column.is_not(None)
            values[f"{field}_{target.value}"] = case((free, source_column), else_=target_column)
            values[f"{field}_{source.value}"] = case((free, None), else_=source_column)
            source_at = getattr(model, f"{field}_{source.value}_updated_at")
            target_at = getattr(model, f"{field}_{target.value}_updated_at")
            values[f"{field}_{target.value}_updated_at"] = case((free, source_at), else_=target_at)
            values[f"{field}_{source.value}_updated_at"] = case((free, None), else_=source_at)
        session.execute(update(model).where(scope).values(**values).execution_options(synchronize_session="fetch"))
    for model, fields in TRIP_TEXTS:
        scope = model.id == trip_id if model is Trip else model.trip_id == trip_id
        for field in fields:
            source_column, target_column = (getattr(model, f"{field}_{code}") for code in (source.value, target.value))
            if session.scalar(
                select(model.id).where(scope, source_column.is_not(None), target_column.is_not(None)).limit(1)
            ):
                raise Refusal(
                    f"A {field} already has text in both languages; clear one before moving the trip's texts",
                    code="trip_text_in_both_languages",
                    params={"field": field},
                )
