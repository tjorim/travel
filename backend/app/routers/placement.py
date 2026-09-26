"""Where a record is: the area, and optionally the location, that a route end or a visit points at."""

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Area, Location
from ..schemas import LocationInput


def selected_area(session: Session, trip_id: str, area_id: str) -> Area:
    area = session.scalar(select(Area).where(Area.id == area_id, Area.trip_id == trip_id))
    if area is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Area is unavailable for this trip"
        )
    return area


def area_for_location(session: Session, trip_id: str, location: Location) -> Area:
    """The area a new location belongs to, found or made from the location's own city.

    An existing area with the same name (and a compatible country) is reused, so
    every hotel and airport in Taipei ends up in one "Taipei". A location without
    city data is still filed, temporarily, under one private "Unassigned"
    area for its trip. This preserves the one non-negotiable relationship:
    every location has an area, while making those incomplete records easy to find
    and rename in the owner UI."""
    name = (location.locality or location.admin_area or "").strip()
    fallback = not name
    if fallback:
        name = "Unassigned"
    for area in session.scalars(select(Area).where(Area.trip_id == trip_id, func.lower(Area.label) == name.lower())):
        if not area.country_code or not location.country_code or area.country_code == location.country_code:
            return area
    area = Area(
        trip_id=trip_id,
        label=name[:120],
        country_code=location.country_code,
        region=location.admin_area if location.locality and not fallback else None,
        latitude=round(location.latitude, 2)
        if not fallback and location.latitude is not None and location.longitude is not None
        else None,
        longitude=round(location.longitude, 2)
        if not fallback and location.latitude is not None and location.longitude is not None
        else None,
    )
    session.add(area)
    session.flush()
    return area


# Fields that make a location more than "somewhere in this area".
_IDENTIFYING = (
    "osm_element_id",
    "display_name",
    "address_line1",
    "address_line2",
    "postal_code",
    "latitude",
    "longitude",
    "navigation_provider_place_id",
    "notes",
)


def is_city_level(location: Location) -> bool:
    """Whether a location names nothing but its area, like an undecided stay's."""
    return all(getattr(location, field) is None for field in _IDENTIFYING)


def area_location(session: Session, trip_id: str, area: Area) -> Location:
    """The one location that means just "in this area", created on first use.

    A stay whose accommodation is still undecided needs a location, and every
    such stay in the same city shares this one instead of each adding its own
    copy of the area's name."""
    candidates = (
        select(Location)
        .where(
            Location.trip_id == trip_id,
            Location.area_id == area.id,
            *(getattr(Location, field).is_(None) for field in _IDENTIFYING),
        )
        .order_by(Location.created_at)
    )
    for location in session.scalars(candidates):
        if location.locality is None or location.locality.lower() == area.label.lower():
            return location
    location = Location(trip_id=trip_id, area=area, locality=area.label, country_code=area.country_code)
    session.add(location)
    session.flush()
    return location


def location_from_input(session: Session, trip_id: str, payload: LocationInput) -> Location:
    """Create a location in its area, or return the location the trip already has."""
    if payload.existing_location_id is not None:
        existing = session.scalar(
            select(Location).where(Location.id == payload.existing_location_id, Location.trip_id == trip_id)
        )
        if existing is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Location not found on this trip"
            )
        return existing
    location = Location(trip_id=trip_id, **payload.model_dump(exclude={"existing_location_id", "area_id", "new_area"}))
    if payload.new_area is not None:
        location.area = Area(trip_id=trip_id, **payload.new_area.model_dump())
        session.add(location.area)
        session.flush()
    elif payload.area_id is not None:
        location.area = selected_area(session, trip_id, payload.area_id)
    else:
        location.area = area_for_location(session, trip_id, location)
    session.add(location)
    session.flush()
    return location


def resolve_place(
    session: Session, trip_id: str, area_id: str | None, location: LocationInput | None
) -> tuple[Area, Location | None]:
    """The area and optional location of a place a record points at.

    A location is filed under an area, so it settles the area; an area given
    as well must be that one. Used by routes (each end) and by visits."""
    if location is None:
        if area_id is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="An area or a location is required"
            )
        return selected_area(session, trip_id, area_id), None
    found = location_from_input(session, trip_id, location)
    if area_id is not None and found.area_id != area_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="That location is not in the chosen area"
        )
    return found.area, found
