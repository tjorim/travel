"""Owner-only place search: a lookup that only ever suggests, never saves."""

from sqlalchemy.orm import Session

from ..places.search import CachedPlaceSearchService
from ..schemas import Identifier, PlaceReverseGeocodeRequest, PlaceSearchRequest, PlaceSearchResponse
from .trips import owned_trip


def search_places(
    session: Session, subject: str, trip_id: Identifier, payload: PlaceSearchRequest, search: CachedPlaceSearchService
) -> PlaceSearchResponse:
    """Search the configured provider. A provider failure is a ``PlaceSearchError``, answered with its own status."""
    # Resolve ownership before the remote call. A rejected caller must never
    # turn this endpoint into an arbitrary-query proxy.
    owned_trip(session, trip_id, subject)
    return search.search(payload.query)


def reverse_geocode_place(
    session: Session,
    subject: str,
    trip_id: Identifier,
    payload: PlaceReverseGeocodeRequest,
    search: CachedPlaceSearchService,
) -> PlaceSearchResponse:
    """A candidate for a coordinate. It never turns EXIF or device coordinates into a canonical place by itself."""
    owned_trip(session, trip_id, subject)
    return search.reverse(payload.latitude, payload.longitude)
