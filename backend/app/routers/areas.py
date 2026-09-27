"""Owner-only areas: the cities and regions everything else is filed under."""

from math import asin, cos, radians, sin, sqrt
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from timezonefinder import TimezoneFinder

from ..access import receivers, trip_audiences
from ..audit import record_audit_event
from ..auth import current_subject
from ..database import get_session
from ..models import Area, AuditEventKind, AuditTargetType, Location, Route, TravelUpdate, Visit
from ..places.search import CachedPlaceSearchService, PlaceSearchError, get_place_search_service
from ..schemas import (
    AreaInput,
    AreaMergeDuplicate,
    AreaMergeResult,
    AreaResponse,
    AreaSuggestion,
    AreaSuggestRequest,
    AreaUpdate,
    MergeRequest,
)
from .placement import is_city_level
from .trips import owned_trip

router = APIRouter(prefix="/trips/{trip_id}", tags=["areas"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]
SearchServiceDep = Annotated[CachedPlaceSearchService, Depends(get_place_search_service)]
AREA_SUGGESTION_RADIUS_KM = 25
_timezone_finder = TimezoneFinder(in_memory=True)


def distance_km(latitude: float, longitude: float, other_latitude: float, other_longitude: float) -> float:
    dlat = radians(other_latitude - latitude)
    dlon = radians(other_longitude - longitude)
    arc = sin(dlat / 2) ** 2 + cos(radians(latitude)) * cos(radians(other_latitude)) * sin(dlon / 2) ** 2
    return 12742 * asin(min(1, sqrt(arc)))


def suggest_area(
    trip_id: str, payload: AreaSuggestRequest, session: SessionDep, subject: SubjectDep, service: SearchServiceDep
) -> AreaSuggestion:
    """Suggest an area to the owner; never create or re-file anything."""
    trip = owned_trip(session, trip_id, subject)
    candidates = [
        (distance_km(payload.latitude, payload.longitude, area.latitude, area.longitude), area)
        for area in session.scalars(select(Area).where(Area.trip_id == trip.id))
        if area.latitude is not None and area.longitude is not None
    ]
    if candidates:
        distance, closest = min(candidates, key=lambda candidate: candidate[0])
        if distance <= AREA_SUGGESTION_RADIUS_KM:
            return AreaSuggestion(
                existing_area_id=closest.id, area=AreaInput.model_validate(closest, from_attributes=True)
            )
    try:
        result = service.reverse(payload.latitude, payload.longitude).results
    except PlaceSearchError as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)) from error
    place = result[0] if result else None
    label = (
        payload.city or (place.locality or place.admin_area if place else None) or "Nieuw gebied"
    ).strip() or "Nieuw gebied"
    return AreaSuggestion(
        area=AreaInput(
            label=label[:120],
            country_code=place.country_code if place else None,
            region=place.admin_area if place else None,
            latitude=payload.latitude,
            longitude=payload.longitude,
            timezone=_timezone_finder.timezone_at(lat=payload.latitude, lng=payload.longitude),
        )
    )


@router.post("/areas/suggest", response_model=AreaSuggestion)
def suggest_area_endpoint(
    trip_id: str, payload: AreaSuggestRequest, session: SessionDep, subject: SubjectDep, service: SearchServiceDep
) -> AreaSuggestion:
    return suggest_area(trip_id, payload, session, subject, service)


def owned_area(session: Session, trip_id: str, area_id: str) -> Area:
    area = session.scalar(select(Area).where(Area.id == area_id, Area.trip_id == trip_id))
    if area is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Area not found")
    return area


@router.get("/areas", response_model=list[AreaResponse])
def list_areas(
    trip_id: str,
    session: SessionDep,
    subject: SubjectDep,
    q: str | None = None,
    limit: Annotated[int | None, Query(ge=1, le=100)] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[Area]:
    trip = owned_trip(session, trip_id, subject, load_relations=False)
    statement = select(Area).where(Area.trip_id == trip.id).order_by(Area.created_at)
    if q or limit is not None or offset:
        statement = statement.order_by(Area.id)
    if q:
        statement = statement.where(Area.label.ilike(f"%{q}%"))
    if limit is not None:
        statement = statement.limit(limit)
    return list(session.scalars(statement.offset(offset)))


@router.post("/areas", response_model=AreaResponse, status_code=status.HTTP_201_CREATED)
def save_area(trip_id: str, payload: AreaInput, session: SessionDep, subject: SubjectDep) -> Area:
    """Create an owner-selected area without treating it as a visit."""
    trip = owned_trip(session, trip_id, subject)
    if (payload.latitude is None) != (payload.longitude is None):
        raise HTTPException(status_code=422, detail="Supply both coordinates or neither")
    area = Area(trip_id=trip.id, **payload.model_dump())
    session.add(area)
    session.commit()
    return area


@router.patch("/areas/{area_id}", response_model=AreaResponse)
def update_area(trip_id: str, area_id: str, payload: AreaUpdate, session: SessionDep, subject: SubjectDep) -> Area:
    """Edit an owner's area, for example to add its time zone."""
    trip = owned_trip(session, trip_id, subject)
    area = owned_area(session, trip.id, area_id)
    values = payload.model_dump(exclude_unset=True)
    if "label" in values and values["label"] is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="label is required")
    for field, value in values.items():
        setattr(area, field, value)
    if (area.latitude is None) != (area.longitude is None):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Supply both coordinates or neither"
        )
    if area.latitude is not None and area.longitude is not None:
        area.latitude = round(area.latitude, 2)
        area.longitude = round(area.longitude, 2)
    session.commit()
    return area


def _area_references(session: Session, trip_id: str, area_id: str) -> list[str]:
    """Return the owner-facing records that must be changed before deletion.

    An area is deliberately reusable. Deleting it must never silently remove a
    route stop, or detach a story, a location or a route from its context.
    """

    def count(model, *conditions) -> int:
        return session.scalar(select(func.count()).select_from(model).where(model.trip_id == trip_id, *conditions)) or 0

    references = (
        ("bezoek", "bezoeken", count(Visit, Visit.area_id == area_id)),
        ("reisupdate", "reisupdates", count(TravelUpdate, TravelUpdate.area_id == area_id)),
        ("locatie", "locaties", count(Location, Location.area_id == area_id)),
        ("route", "routes", count(Route, (Route.departure_area_id == area_id) | (Route.arrival_area_id == area_id))),
    )
    return [f"{number} {singular if number == 1 else plural}" for singular, plural, number in references if number]


@router.delete("/areas/{area_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_area(trip_id: str, area_id: str, session: SessionDep, subject: SubjectDep) -> Response:
    """Delete an unused owner-authored area without harming its users."""
    trip = owned_trip(session, trip_id, subject)
    area = owned_area(session, trip.id, area_id)
    references = _area_references(session, trip.id, area.id)
    if references:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Dit gebied wordt nog gebruikt door: {', '.join(references)}. Pas of verwijder die eerst.",
        )
    session.delete(area)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _area_referencing(session: Session, trip_id: str, area_id: str) -> dict[str, list]:
    """Every record filed under this area, by kind."""

    def rows(model, *conditions) -> list:
        return list(session.scalars(select(model).where(model.trip_id == trip_id, *conditions)))

    return {
        "locations": rows(Location, Location.area_id == area_id),
        "visits": rows(Visit, Visit.area_id == area_id),
        "routes": rows(Route, (Route.departure_area_id == area_id) | (Route.arrival_area_id == area_id)),
        "travel_updates": rows(TravelUpdate, TravelUpdate.area_id == area_id),
    }


def merge_areas(trip_id: str, payload: MergeRequest, session: Session, subject: str) -> AreaMergeResult:
    """Preview, or with ``confirm`` apply, folding duplicate areas into one kept area.

    Every location, visit, route end and reisupdate filed under a duplicate
    moves to the kept area in one transaction (stays follow their location),
    and then the duplicates are deleted. The kept area keeps its own label,
    point, time zone and visibility. Afterwards its locations sit together, so
    duplicates among them can be folded with ``merge_locations``."""
    trip = owned_trip(session, trip_id, subject)
    keep = owned_area(session, trip.id, payload.keep_id)
    duplicate_ids = list(dict.fromkeys(payload.duplicate_ids))
    if keep.id in duplicate_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="keep_id cannot also be a duplicate"
        )
    duplicates = [owned_area(session, trip.id, duplicate_id) for duplicate_id in duplicate_ids]
    audiences = trip_audiences(session, trip.id)
    kept_by = receivers("area", keep, audiences)
    summaries: list[AreaMergeDuplicate] = []
    warnings: list[str] = []
    moves: list[tuple[Area, dict[str, list]]] = []
    for duplicate in duplicates:
        found = _area_referencing(session, trip.id, duplicate.id)
        moves.append((duplicate, found))
        narrowed = sorted(receivers("area", duplicate, audiences) - kept_by)
        if narrowed:
            warnings.append(
                f"{duplicate.label} reaches {', '.join(narrowed)} but the kept area does not; "
                "after the merge they no longer see it. Share the kept area first to avoid that."
            )
        summaries.append(
            AreaMergeDuplicate(
                id=duplicate.id,
                label=duplicate.label,
                narrowed_audiences=narrowed,
                **{kind: len(rows) for kind, rows in found.items()},
            )
        )
    merged_locations = [
        *session.scalars(select(Location).where(Location.trip_id == trip.id, Location.area_id == keep.id)),
        *(location for _, found in moves for location in found["locations"]),
    ]
    city_level = [location.id for location in merged_locations if is_city_level(location)]
    if len(city_level) < 2:
        city_level = []
    else:
        warnings.append(
            f"{len(city_level)} locations in the merged area name only the city; "
            "fold them into one with merge_locations."
        )
    result = AreaMergeResult(
        keep_id=keep.id,
        applied=payload.confirm,
        duplicates=summaries,
        city_level_location_ids=city_level,
        warnings=warnings,
    )
    if not payload.confirm:
        return result
    for duplicate, found in moves:
        for record in (*found["locations"], *found["visits"]):
            record.area = keep
        for update in found["travel_updates"]:
            update.chosen_area = keep
        for route in found["routes"]:
            for end in ("departure", "arrival"):
                if getattr(route, f"{end}_area_id") == duplicate.id:
                    setattr(route, f"{end}_area", keep)
    session.flush()
    for duplicate, _ in moves:
        session.delete(duplicate)
    record_audit_event(
        session,
        trip_id=trip.id,
        actor_subject=subject,
        kind=AuditEventKind.AREA_MERGE,
        target_type=AuditTargetType.AREA,
        target_id=keep.id,
        details={
            "merged": [
                {"id": summary.id, **summary.model_dump(include={"locations", "visits", "routes", "travel_updates"})}
                for summary in summaries
            ]
        },
    )
    return result


@router.post("/areas/merge", response_model=AreaMergeResult)
def merge_areas_endpoint(
    trip_id: str, payload: MergeRequest, session: SessionDep, subject: SubjectDep
) -> AreaMergeResult:
    result = merge_areas(trip_id, payload, session, subject)
    session.commit()
    return result
