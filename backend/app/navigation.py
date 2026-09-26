"""Navigation target construction after an audience has been resolved."""

from urllib.parse import urlencode

from .models import Area, Location


def google_maps_url(destination: str) -> str:
    return f"https://www.google.com/maps/dir/?{urlencode({'api': '1', 'destination': destination})}"


def location_navigation_url(place: Location) -> str | None:
    """Build an exact target only for an owner or an explicit capability."""
    if place.latitude is not None and place.longitude is not None:
        return google_maps_url(f"{place.latitude:.7f},{place.longitude:.7f}")
    # A selected display snapshot may still be an exact destination even when
    # the provider did not supply a point, so it remains owner/capability-only.
    destination = place.display_name or ", ".join(filter(None, [place.address_line1, place.locality]))
    return google_maps_url(destination) if destination else None


def area_navigation_url(place: Area) -> str:
    """Never use an area's optional generalized point for navigation.

    A city-level textual target is intentionally less precise and avoids
    promoting a map-display coordinate into an external navigation destination.
    """
    destination = ", ".join(filter(None, [place.label, place.region, place.country_code]))
    return google_maps_url(destination)
