"""Travel updates: what the owner writes while travelling, and which of it a visitor may read."""

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..access import apply_visibility, receivers
from ..audit import delivering_audiences, record_visibility_change
from ..errors import RecordNotFound, Refusal, service_error
from ..models import TRAVEL_UPDATE_ORDER, Location, MediaAsset, TravelUpdate, TravelUpdateMediaAsset, Trip, Visibility
from ..schemas import Identifier, TravelUpdateCreate, TravelUpdatePatch
from .placement import location_from_input, selected_area
from .trips import owned_trip


def media_links_from_ids(
    session: Session, trip_id: Identifier, media_asset_ids: list[str]
) -> list[TravelUpdateMediaAsset]:
    """Resolve attachments inside the already-authorized trip boundary.

    The association intentionally stores no EXIF, file URL or share state.
    A client can only attach non-deleted assets owned by this trip.
    """
    if not media_asset_ids:
        return []
    assets = list(
        session.scalars(
            select(MediaAsset).where(
                MediaAsset.trip_id == trip_id,
                MediaAsset.id.in_(media_asset_ids),
                MediaAsset.deleted_at.is_(None),
            )
        )
    )
    if len(assets) != len(media_asset_ids):
        raise Refusal(
            "One or more media assets are unavailable for this trip",
            code="one_or_more_media_assets_are_unavailable_for_this_trip",
        )
    by_id = {asset.id: asset for asset in assets}
    return [TravelUpdateMediaAsset(media_asset=by_id[asset_id]) for asset_id in media_asset_ids]


def owned_update(session: Session, trip: Trip, update_id: Identifier) -> TravelUpdate:
    update = session.scalar(select(TravelUpdate).where(TravelUpdate.id == update_id, TravelUpdate.trip_id == trip.id))
    if update is None:
        raise RecordNotFound("Travel update not found")
    return update


def travel_update_by_id(session: Session, update_id: Identifier) -> TravelUpdate:
    """An update just written, read afresh with its area, location and media (after a commit expired it)."""
    return session.execute(
        select(TravelUpdate)
        .options(
            selectinload(TravelUpdate.chosen_area),
            selectinload(TravelUpdate.location),
            selectinload(TravelUpdate.media_links),
        )
        .where(TravelUpdate.id == update_id)
    ).scalar_one()


def list_travel_updates(
    session: Session,
    subject: str,
    trip_id: Identifier,
    *,
    q: str | None = None,
    limit: int | None = None,
    offset: int = 0,
    latest: int | None = None,
) -> list[TravelUpdate]:
    """The trip's updates in chronological order (``TRAVEL_UPDATE_ORDER``, the order of every other surface)."""
    trip = owned_trip(session, trip_id, subject)
    statement = (
        select(TravelUpdate)
        .options(
            selectinload(TravelUpdate.chosen_area),
            selectinload(TravelUpdate.location).selectinload(Location.area),
            selectinload(TravelUpdate.media_links),
        )
        .where(TravelUpdate.trip_id == trip.id)
    )
    if q:
        statement = statement.where(TravelUpdate.title.ilike(f"%{q}%"))
    if latest is not None:
        # The tail of the one order, read from its end and put back: no second rule.
        tail = statement.order_by(*(column.desc() for column in TRAVEL_UPDATE_ORDER)).limit(latest)
        return list(reversed(list(session.scalars(tail))))
    statement = statement.order_by(*TRAVEL_UPDATE_ORDER)
    if limit is not None:
        statement = statement.limit(limit)
    return list(session.scalars(statement.offset(offset)))


def create_travel_update(
    session: Session, subject: str, trip_id: Identifier, payload: TravelUpdateCreate
) -> TravelUpdate:
    trip = owned_trip(session, trip_id, subject)
    location = location_from_input(session, trip.id, payload.location) if payload.location else None
    if location is not None and payload.area_id is not None:
        raise Refusal(
            "An update with a location gets its area from that location",
            code="an_update_with_a_location_gets_its_area_from_that_location",
        )
    update = TravelUpdate(
        trip_id=trip.id,
        area_id=selected_area(session, trip.id, payload.area_id).id
        if location is None and payload.area_id is not None
        else None,
        location=location,
        media_links=media_links_from_ids(session, trip.id, payload.media_asset_ids),
        occurred_at=payload.occurred_at,
        date_precision=payload.date_precision,
        title=payload.title,
        body=payload.body,
        private_notes=payload.private_notes,
    )
    session.add(update)
    session.flush()
    if payload.visibility != Visibility.PRIVATE:
        _choose_visibility(session, trip, update, payload.visibility, subject)
    return update


def _choose_visibility(
    session: Session, trip: Trip, update: TravelUpdate, visibility: Visibility, subject: str
) -> None:
    before = update.visibility or Visibility.PRIVATE
    before_receivers = receivers("travel_update", update, delivering_audiences(session, trip.id))
    try:
        apply_visibility("travel_update", update, visibility)
    except ValueError as error:
        raise service_error(error) from error
    record_visibility_change(
        session,
        trip_id=trip.id,
        actor_subject=subject,
        kind="travel_update",
        record=update,
        before=before,
        before_receivers=before_receivers,
    )


def update_travel_update(
    session: Session, subject: str, trip_id: Identifier, update_id: Identifier, payload: TravelUpdatePatch
) -> TravelUpdate:
    trip = owned_trip(session, trip_id, subject)
    update = owned_update(session, trip, update_id)
    # A present null is intentional: the owner may remove a location or notes
    # while editing. Pydantic otherwise represents omitted and null alike.
    if "location" in payload.model_fields_set:
        update.location = location_from_input(session, trip.id, payload.location) if payload.location else None
    if update.location is not None:
        if "area_id" in payload.model_fields_set and payload.area_id is not None:
            raise Refusal(
                "An update with a location gets its area from that location",
                code="an_update_with_a_location_gets_its_area_from_that_location",
            )
        update.area_id = None
    elif "area_id" in payload.model_fields_set:
        update.area_id = selected_area(session, trip.id, payload.area_id).id if payload.area_id is not None else None
    if "media_asset_ids" in payload.model_fields_set:
        update.media_links = media_links_from_ids(session, trip.id, payload.media_asset_ids or [])
    values = payload.model_dump(exclude_unset=True, exclude={"area_id", "location", "media_asset_ids", "visibility"})
    for field, value in values.items():
        if value is None and field in {"occurred_at", "date_precision", "title", "body"}:
            raise Refusal(f"{field} is required", code="missing", field=field)
        setattr(update, field, value)
    if payload.visibility is not None:
        _choose_visibility(session, trip, update, payload.visibility, subject)
    elif update.visibility != Visibility.PRIVATE and not update.body.strip():
        # An update cannot keep reaching visitors once its text is emptied.
        raise Refusal(
            "Write the text for visitors before sharing this update",
            code="write_the_text_for_visitors_before_sharing_this_update",
        )
    session.flush()
    return update


def delete_travel_update(session: Session, subject: str, trip_id: Identifier, update_id: Identifier) -> None:
    trip = owned_trip(session, trip_id, subject)
    session.delete(owned_update(session, trip, update_id))
    session.flush()
