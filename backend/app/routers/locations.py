"""Owner-only locations: hotels, stations and monuments, each filed under one area."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..access import receivers, trip_audiences
from ..audit import record_audit_event
from ..auth import current_subject
from ..database import get_session
from ..errors import ApiException
from ..models import (
    AuditEventKind,
    AuditTargetType,
    Location,
    Route,
    Stay,
    TravelUpdate,
    Visibility,
    Visit,
)
from ..navigation import location_navigation_url
from ..schemas import (
    LocationInput,
    LocationMergeDuplicate,
    LocationMergeResult,
    LocationResponse,
    LocationUpdate,
    MergeRequest,
    NavigationResponse,
)
from .placement import location_from_input, selected_area
from .trips import owned_trip

router = APIRouter(prefix="/trips/{trip_id}", tags=["locations"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]


def owned_location(session: Session, trip_id: str, subject: str, location_id: str) -> Location:
    owned_trip(session, trip_id, subject)
    location = session.scalar(select(Location).where(Location.id == location_id, Location.trip_id == trip_id))
    if location is None:
        raise ApiException(status_code=status.HTTP_404_NOT_FOUND, detail="Location not found", code="not_found")
    return location


@router.get("/locations", response_model=list[LocationResponse])
def list_locations(
    trip_id: str,
    session: SessionDep,
    subject: SubjectDep,
    q: str | None = None,
    limit: Annotated[int | None, Query(ge=1, le=100)] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[Location]:
    trip = owned_trip(session, trip_id, subject, load_relations=False)
    statement = select(Location).where(Location.trip_id == trip.id).order_by(Location.created_at)
    if q or limit is not None or offset:
        statement = statement.order_by(Location.id)
    if q:
        statement = statement.where(Location.label.ilike(f"%{q}%") | Location.display_name.ilike(f"%{q}%"))
    if limit is not None:
        statement = statement.limit(limit)
    return list(session.scalars(statement.offset(offset)))


@router.post("/locations", response_model=LocationResponse, status_code=status.HTTP_201_CREATED)
def save_location(trip_id: str, payload: LocationInput, session: SessionDep, subject: SubjectDep) -> Location:
    trip = owned_trip(session, trip_id, subject)
    location = location_from_input(session, trip.id, payload)
    session.commit()
    return location


def _carry_links(session: Session, location: Location) -> None:
    """Keep every route end and visit at this location in the location's new area.

    A record's area must hold its location, so moving the location moves them
    with it instead of leaving the owner to detach, move and reattach each one.
    Stays and reisupdates take their area from the location already."""
    for end in ("departure", "arrival"):
        for route in session.scalars(select(Route).where(getattr(Route, f"{end}_location_id") == location.id)):
            setattr(route, f"{end}_area", location.area)
    for visit in session.scalars(select(Visit).where(Visit.location_id == location.id)):
        visit.area = location.area


# What a place-search result says about one place: stale once the point moves elsewhere.
_PROVIDER_REFERENCES = (
    "osm_element_type",
    "osm_element_id",
    "viewport_north",
    "viewport_south",
    "viewport_east",
    "viewport_west",
    "navigation_provider",
    "navigation_provider_place_id",
)


def _unprocessable(detail: str, code: str) -> ApiException:
    return ApiException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail, code=code)


def _apply_map_target(location: Location, payload: LocationUpdate) -> None:
    """Apply the point, viewport, OSM element and navigation provider fields the payload names.

    Omitted fields keep their values and explicit nulls clear them. The OSM URL
    always follows the stored element, and a point that moves may not keep
    provider references describing the old place."""
    changes = payload.model_fields_set
    if "latitude" in changes:
        point = (payload.latitude, payload.longitude)
        if point != (location.latitude, location.longitude) and payload.latitude is not None:
            if location.visibility != Visibility.PRIVATE:
                # A shared location publishes its point, so a new one is the owner's explicit sharing decision.
                raise _unprocessable(
                    "Make this location private before changing its point, then share it again",
                    "make_this_location_private_before_changing_its_point_then_share_it_again",
                )
            stale = [field for field in _PROVIDER_REFERENCES if getattr(location, field) is not None]
            if any(field not in changes for field in stale):
                raise _unprocessable(
                    "Moving the point also needs the OSM element, viewport and navigation provider "
                    "of the new place: send them, or null the ones that no longer apply",
                    "moving_the_point_needs_the_osm_element_viewport_and_navigation_provider_of_the_new_place",
                )
        location.latitude, location.longitude = point
    for field in _PROVIDER_REFERENCES:
        if field in changes:
            setattr(location, field, getattr(payload, field))
    if "osm_element_type" in changes:
        location.osm_url = (
            f"https://www.openstreetmap.org/{location.osm_element_type}/{location.osm_element_id}"
            if location.osm_element_type is not None
            else None
        )
    if location.navigation_provider_place_id is not None and location.navigation_provider is None:
        raise _unprocessable(
            "A navigation provider place id needs a navigation provider",
            "a_navigation_provider_place_id_needs_a_navigation_provider",
        )


@router.patch("/locations/{location_id}", response_model=LocationResponse)
def update_location(
    trip_id: str, location_id: str, payload: LocationUpdate, session: SessionDep, subject: SubjectDep
) -> Location:
    """Correct a saved location, or apply a verified place-search result to it, in place.

    The location is reusable: every linked stay, visit, route end and update
    reads the corrected address and map target from this same record. Its id,
    area, visibility and sharing choices are never changed by a map-target update.
    """
    location = owned_location(session, trip_id, subject, location_id)
    changes = payload.model_fields_set
    if "label" in changes:
        location.label = payload.label
    if "area_id" in changes:
        if payload.area_id is None:
            raise ApiException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Every location needs an area",
                code="every_location_needs_an_area",
            )
        location.area = selected_area(session, trip_id, payload.area_id)
        _carry_links(session, location)
    if "share_address" in changes and payload.share_address is not None:
        location.share_address = payload.share_address
    for field in (
        "display_name",
        "address_line1",
        "address_line2",
        "locality",
        "admin_area",
        "postal_code",
        "country_code",
        "notes",
    ):
        if field in changes:
            setattr(location, field, getattr(payload, field))
    _apply_map_target(location, payload)
    if location.share_address and not any(
        (location.address_line1, location.address_line2, location.postal_code, location.locality, location.admin_area)
    ):
        raise ApiException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Add an address before sharing it",
            code="add_an_address_before_sharing_it",
        )
    if location.label is None and location.visibility != Visibility.PRIVATE:
        # A shared location cannot lose its public name.
        raise ApiException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Give this location a public name before sharing it",
            code="give_this_location_a_public_name_before_sharing_it",
        )
    session.commit()
    return location


@router.get("/locations/{location_id}/navigation", response_model=NavigationResponse)
def owner_navigation(location_id: str, trip_id: str, session: SessionDep, subject: SubjectDep) -> NavigationResponse:
    location = owned_location(session, trip_id, subject, location_id)
    url = location_navigation_url(location)
    if url is None:
        raise ApiException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Location has no navigation target",
            code="location_has_no_navigation_target",
        )
    return NavigationResponse(url=url, exact=True)


def _referencing(session: Session, trip_id: str, location_id: str) -> dict[str, list]:
    """Every record that points at this location, by kind."""

    def rows(model, *conditions) -> list:
        return list(session.scalars(select(model).where(model.trip_id == trip_id, *conditions)))

    return {
        "visits": rows(Visit, Visit.location_id == location_id),
        "stays": rows(Stay, Stay.location_id == location_id),
        "routes": rows(
            Route, (Route.departure_location_id == location_id) | (Route.arrival_location_id == location_id)
        ),
        "travel_updates": rows(TravelUpdate, TravelUpdate.location_id == location_id),
    }


_REFERENCE_NAMES = {
    "visits": ("bezoek", "bezoeken"),
    "stays": ("verblijf", "verblijven"),
    "routes": ("route", "routes"),
    "travel_updates": ("reisupdate", "reisupdates"),
}


@router.delete("/locations/{location_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_location(trip_id: str, location_id: str, session: SessionDep, subject: SubjectDep) -> Response:
    """Delete an unused location; refuse while any visit, stay, route or reisupdate still points at it."""
    location = owned_location(session, trip_id, subject, location_id)
    found_by_kind = _referencing(session, trip_id, location.id)
    references = [
        f"{len(found)} {_REFERENCE_NAMES[kind][0] if len(found) == 1 else _REFERENCE_NAMES[kind][1]}"
        for kind, found in found_by_kind.items()
        if found
    ]
    if references:
        raise ApiException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Deze locatie wordt nog gebruikt door: {', '.join(references)}. "
            "Pas of verwijder die eerst, of voeg de locatie samen met een andere.",
            code="resource_in_use",
            params={
                **{kind: len(found) for kind, found in found_by_kind.items()},
                "count": sum(len(found) for found in found_by_kind.values()),
            },
        )
    session.delete(location)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def merge_locations(trip_id: str, payload: MergeRequest, session: Session, subject: str) -> LocationMergeResult:
    """Preview, or with ``confirm`` apply, folding duplicates into one kept location.

    Every visit, stay, route end and reisupdate at a duplicate moves to the kept
    location in one transaction, and then the duplicates are deleted. The kept
    location keeps its own name, visibility and area; visits and route ends move
    into that area with it."""
    keep = owned_location(session, trip_id, subject, payload.keep_id)
    duplicate_ids = list(dict.fromkeys(payload.duplicate_ids))
    if keep.id in duplicate_ids:
        raise ApiException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="keep_id cannot also be a duplicate",
            code="keep_id_cannot_also_be_a_duplicate",
        )
    duplicates = [owned_location(session, trip_id, subject, duplicate_id) for duplicate_id in duplicate_ids]
    audiences = trip_audiences(session, trip_id)
    kept_by = receivers("location", keep, audiences)
    summaries: list[LocationMergeDuplicate] = []
    warnings: list[str] = []
    moves: list[tuple[Location, dict[str, list]]] = []
    for duplicate in duplicates:
        found = _referencing(session, trip_id, duplicate.id)
        moves.append((duplicate, found))
        narrowed = sorted(receivers("location", duplicate, audiences) - kept_by)
        name = duplicate.label or duplicate.display_name or duplicate.id
        if narrowed:
            warnings.append(
                f"{name} reaches {', '.join(narrowed)} but the kept location does not; "
                "after the merge they no longer see it. Share the kept location first to avoid that."
            )
        if duplicate.area_id != keep.area_id and (found["visits"] or found["routes"]):
            warnings.append(f"Visits and routes at {name} move to the kept location's area.")
        summaries.append(
            LocationMergeDuplicate(
                id=duplicate.id,
                label=duplicate.label,
                display_name=duplicate.display_name,
                area_id=duplicate.area_id,
                narrowed_audiences=narrowed,
                **{kind: len(rows) for kind, rows in found.items()},
            )
        )
    result = LocationMergeResult(keep_id=keep.id, applied=payload.confirm, duplicates=summaries, warnings=warnings)
    if not payload.confirm:
        return result
    for duplicate, found in moves:
        for visit in found["visits"]:
            visit.location = keep
        for stay in found["stays"]:
            stay.location = keep
        for update in found["travel_updates"]:
            update.location = keep
        for route in found["routes"]:
            for end in ("departure", "arrival"):
                if getattr(route, f"{end}_location_id") == duplicate.id:
                    setattr(route, f"{end}_location", keep)
    session.flush()
    _carry_links(session, keep)
    for duplicate, _ in moves:
        session.delete(duplicate)
    record_audit_event(
        session,
        trip_id=trip_id,
        actor_subject=subject,
        kind=AuditEventKind.LOCATION_MERGE,
        target_type=AuditTargetType.LOCATION,
        target_id=keep.id,
        details={
            "merged": [
                {"id": summary.id, **summary.model_dump(include={"visits", "stays", "routes", "travel_updates"})}
                for summary in summaries
            ]
        },
    )
    return result


@router.post("/locations/merge", response_model=LocationMergeResult)
def merge_locations_endpoint(
    trip_id: str, payload: MergeRequest, session: SessionDep, subject: SubjectDep
) -> LocationMergeResult:
    result = merge_locations(trip_id, payload, session, subject)
    session.commit()
    return result
