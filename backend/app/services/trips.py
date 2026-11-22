"""Ownership of a trip: every owner operation starts here."""

from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session, selectinload

from app.core.content_language import DEFAULT_LANGUAGE, ContentLanguage
from app.core.errors import RecordNotFound, Refusal, ServiceError, service_error
from app.services.audit import scrub_trip_audit_text
from app.services.sharing.access import set_cover
from app.services.sharing.overview import trip_overview

from ..models import (
    DocumentAsset,
    Location,
    MediaDerivative,
    ObjectState,
    Route,
    Stay,
    StoredObject,
    TravelUpdate,
    Trip,
    cover_file_route,
)
from ..schemas import Identifier, TripCreate, TripResponse, TripSummaryResponse, TripUpdate
from .localized import move_texts, write_texts

DEFAULT_TRIP_PAGE = 100


def trip_query():
    return select(Trip).options(
        selectinload(Trip.areas),
        selectinload(Trip.locations),
        selectinload(Trip.travel_updates).selectinload(TravelUpdate.chosen_area),
        selectinload(Trip.travel_updates).selectinload(TravelUpdate.location).selectinload(Location.area),
        selectinload(Trip.travel_updates).selectinload(TravelUpdate.media_links),
        selectinload(Trip.stays).selectinload(Stay.area),
        selectinload(Trip.stays).selectinload(Stay.location).selectinload(Location.area),
        selectinload(Trip.stays).selectinload(Stay.document_links),
        selectinload(Trip.routes).selectinload(Route.departure_area),
        selectinload(Trip.routes).selectinload(Route.arrival_area),
        selectinload(Trip.routes).selectinload(Route.departure_location).selectinload(Location.area),
        selectinload(Trip.routes).selectinload(Route.arrival_location).selectinload(Location.area),
        selectinload(Trip.routes).selectinload(Route.document_links),
        selectinload(Trip.trip_tasks),
        selectinload(Trip.media_derivatives).selectinload(MediaDerivative.media_asset),
    )


def owned_trip(
    session: Session, trip_id: Identifier, subject: str, *, load_relations: bool = False, lock: bool = False
) -> Trip:
    """The owner's trip, or 404.

    By default this reads only the trip row: the check that the subject owns it. A handler that walks the trip's
    records (a projection, the overview, a response that embeds them) passes ``load_relations=True``; everything
    else reads the records it needs with a query of its own, so a write costs the same in a trip of any size.

    ``lock=True`` also takes the trip row lock until the transaction ends (``FOR NO KEY UPDATE``, as ``lock_trip``,
    in the same query). The writers of localized text take it, so a move of the trip's texts to another content
    language (``localized.move_texts``) never runs beside a write it would overwrite or be overwritten by.
    """
    statement = trip_query() if load_relations else select(Trip)
    statement = statement.where(Trip.id == trip_id, Trip.owner_subject == subject)
    if lock:
        statement = statement.with_for_update(key_share=True)
    trip = session.scalar(statement)
    if trip is None:
        raise RecordNotFound("Trip not found")
    return trip


def lock_trip(session: Session, trip_id: Identifier, subject: str) -> None:
    """Take the owner's trip row lock until the transaction ends, or 404 when the trip is gone or not theirs.

    Deleting a trip scrubs the owner's text (link labels, reasons) from its retained sharing events under this lock,
    and a writer of such an event takes it before writing, so no label or reason can land after the scrub. It is
    ``FOR NO KEY UPDATE``: a child row's foreign-key check (``FOR KEY SHARE``) does not wait for it, which keeps the
    media worker's import and the delete from deadlocking."""
    if (
        session.scalar(
            select(Trip.id).where(Trip.id == trip_id, Trip.owner_subject == subject).with_for_update(key_share=True)
        )
        is None
    ):
        raise RecordNotFound("Trip not found")


def _covers(session: Session, trip_ids: list[str]) -> dict[str, MediaDerivative]:
    """The chosen cover copy of each trip, in one query that reads no other copy of the trip."""
    return {
        cover.trip_id: cover
        for cover in session.scalars(
            select(MediaDerivative).where(MediaDerivative.trip_id.in_(trip_ids), MediaDerivative.is_cover.is_(True))
        )
    }


def _trip_fields(trip: Trip, cover: MediaDerivative | None) -> dict:
    return {
        "id": trip.id,
        "owner_subject": trip.owner_subject,
        "content_language": trip.content_language,
        "title": trip.title,
        "translation_freshness": trip.translation_freshness,
        "title_nl": trip.title_nl,
        "title_en": trip.title_en,
        "summary": trip.summary,
        "summary_nl": trip.summary_nl,
        "summary_en": trip.summary_en,
        "starts_on": trip.starts_on,
        "ends_on": trip.ends_on,
        "cover_derivative_id": cover.id if cover else None,
        "cover_url": cover_file_route(trip.id, cover) if cover else None,
    }


def trip_response(session: Session, trip: Trip) -> TripResponse:
    """The trip's own fields and cover: two small queries, whatever the trip holds."""
    return TripResponse(**_trip_fields(trip, _covers(session, [trip.id]).get(trip.id)))


def list_trips(
    session: Session, subject: str, *, q: str | None = None, limit: int = DEFAULT_TRIP_PAGE, offset: int = 0
) -> list[TripSummaryResponse]:
    """The owner's trips, newest first, without any embedded record."""
    statement = select(Trip).where(Trip.owner_subject == subject).order_by(Trip.created_at.desc(), Trip.id)
    if q:
        statement = statement.where(or_(Trip.title_nl.ilike(f"%{q}%"), Trip.title_en.ilike(f"%{q}%")))
    found = list(session.scalars(statement.limit(limit).offset(offset)))
    ids = [trip.id for trip in found]
    covers = _covers(session, ids)
    updates = {
        trip_id: (count, last)
        for trip_id, count, last in session.execute(
            select(TravelUpdate.trip_id, func.count(), func.max(TravelUpdate.occurred_at))
            .where(TravelUpdate.trip_id.in_(ids))
            .group_by(TravelUpdate.trip_id)
        )
    }
    summaries = []
    for trip in found:
        update_count, last_update_at = updates.get(trip.id, (0, None))
        summaries.append(
            TripSummaryResponse(
                **_trip_fields(trip, covers.get(trip.id)),
                travel_update_count=update_count,
                last_update_at=last_update_at,
            )
        )
    return summaries


def create_trip(session: Session, subject: str, payload: TripCreate) -> TripResponse:
    language = payload.content_language or DEFAULT_LANGUAGE
    trip = Trip(
        owner_subject=subject, content_language=language.value, starts_on=payload.starts_on, ends_on=payload.ends_on
    )
    write_texts(trip, ("title", "summary"), payload, language.value, required=("title",))
    session.add(trip)
    session.flush()
    return trip_response(session, trip)


def get_trip(session: Session, subject: str, trip_id: Identifier) -> TripResponse:
    return trip_response(session, owned_trip(session, trip_id, subject))


def get_trip_overview(session: Session, subject: str, trip_id: Identifier) -> dict:
    """Counts per kind, what each audience receives, and what to review before sharing."""
    return trip_overview(session, owned_trip(session, trip_id, subject, load_relations=True))


def update_trip(session: Session, subject: str, trip_id: Identifier, payload: TripUpdate) -> TripResponse:
    trip = owned_trip(session, trip_id, subject, lock=True)
    changes = payload.model_dump(
        exclude_unset=True,
        exclude={
            "title",
            "title_nl",
            "title_en",
            "summary",
            "summary_nl",
            "summary_en",
            "move_texts",
            "content_language",
        },
    )
    if "cover_derivative_id" in changes:
        try:
            set_cover(trip, changes.pop("cover_derivative_id"))
        except ServiceError as error:
            raise service_error(error) from error
    if payload.content_language is not None and payload.content_language.value != trip.content_language:
        previous = ContentLanguage(trip.content_language)
        if payload.move_texts:
            move_texts(session, trip.id, previous, payload.content_language)
            session.refresh(trip)
        trip.content_language = payload.content_language.value
    elif payload.move_texts:
        raise Refusal(
            "Choose a different content language to move the trip's texts to",
            code="move_texts_needs_a_new_content_language",
            field="move_texts",
        )
    write_texts(trip, ("title", "summary"), payload, trip.content_language, required=("title",))
    for field, value in changes.items():
        setattr(trip, field, value)
    if trip.starts_on is not None and trip.ends_on is not None and trip.ends_on < trip.starts_on:
        raise Refusal("The trip cannot end before it starts", code="the_trip_cannot_end_before_it_starts")
    session.flush()
    return trip_response(session, trip)


def delete_trip(session: Session, subject: str, trip_id: Identifier) -> None:
    """Delete the trip and everything it holds; its stored objects wait for the purge (``docs/object-storage.md``).

    The owner's documents filed under the trip are not part of it: they stay, unfiled, with their files (and lose
    their attachments with the stays and routes that held them)."""
    # First, so a writer of a sharing event with owner text either finishes before the scrub below or finds no trip.
    lock_trip(session, trip_id, subject)
    # The delete cascades through the records and their links, so read them together instead of one by one.
    trip = owned_trip(session, trip_id, subject, load_relations=True)
    # Serialize with result attachment before taking the final object inventory.
    # Worker jobs survive derivative deletion with a null link; dispatch retries
    # cancellation/ACK without making any provider call inside this transaction.
    list(session.scalars(select(MediaDerivative).where(MediaDerivative.trip_id == trip_id).with_for_update()))
    for stored in session.scalars(select(StoredObject).where(StoredObject.trip_id == trip_id).with_for_update()):
        stored.state = ObjectState.PURGE_PENDING
        stored.trip_id = None
    # The owner's documents are not the trip's: unfile them (the foreign key does the same on PostgreSQL).
    session.execute(update(DocumentAsset).where(DocumentAsset.trip_id == trip_id).values(trip_id=None))
    session.flush()
    scrub_trip_audit_text(session, trip_id)
    session.delete(trip)
    session.flush()
