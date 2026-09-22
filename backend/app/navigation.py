"""Navigation target construction after an audience has been resolved."""

from urllib.parse import urlencode

from .models import Place, Trip
from .projection import _resources


def google_maps_url(destination: str) -> str:
    return f"https://www.google.com/maps/dir/?{urlencode({'api': '1', 'destination': destination})}"


def exact_navigation_url(place: Place) -> str | None:
    """Build an exact target only for an owner or an explicit capability."""
    if place.latitude is not None and place.longitude is not None:
        return google_maps_url(f"{place.latitude:.7f},{place.longitude:.7f}")
    # A selected display snapshot may still be an exact destination even when
    # the provider did not supply a point, so it remains owner/capability-only.
    destination = place.display_name or ", ".join(filter(None, [place.address_line1, place.locality]))
    return google_maps_url(destination) if destination else None


def broad_navigation_url(place: Place) -> str:
    """Never use a broad place's optional generalized point for navigation.

    A city-level textual target is intentionally less precise and avoids
    promoting a map-display coordinate into an external navigation destination.
    """
    destination = ", ".join(filter(None, [place.label, place.region, place.country_code]))
    return google_maps_url(destination)


def scoped_navigation_url(trip: Trip, scope: dict, local_id: str) -> tuple[str, bool] | None:
    """Resolve a projection-local navigation marker after scope validation.

    IDs are deliberately local to one rendered response. An internal place ID
    never becomes a public route parameter, and an exact target has no
    fallback path unless its own scope item explicitly grants navigation.
    """
    resources = _resources(trip)
    for index, scope_item in enumerate(scope.get("items", []), start=1):
        kind = scope_item.get("kind")
        if local_id != f"{kind}-{index}" or "navigation" not in scope_item.get("fields", []):
            continue
        item = resources.get(kind, {}).get(scope_item.get("id"))
        if item is None:
            return None
        if kind == "exact_place":
            destination = exact_navigation_url(item)
            return (destination, True) if destination else None
        if kind == "broad_place":
            return broad_navigation_url(item), False
        if kind in {"route_stage", "moment_excerpt", "broad_stay_card"}:
            place = item.place if kind != "moment_excerpt" else item.broad_place
            if place is not None:
                return broad_navigation_url(place), False
    return None
