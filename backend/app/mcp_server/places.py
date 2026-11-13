"""Places, areas, locations and the visibility of one record."""

from __future__ import annotations

from typing import Any

from .. import schemas
from ..models import Visibility
from ..services import areas as area_service
from ..services import locations as location_service
from ..services import places as place_service
from ..services import visibility as visibility_service
from .core import McpTools
from .rendering import _listed, _model


class PlaceTools(McpTools):
    """Places, areas, locations and the visibility of one record."""

    def search_places(self, trip_id: str, payload: schemas.PlaceSearchRequest) -> dict[str, Any]:
        """Explicitly search the configured owner-only place provider; this never saves a place."""
        from ..places.search import get_place_search_service

        return self._call(
            "place.search",
            "place_search",
            None,
            trip_id,
            lambda s, sub: place_service.search_places(s, sub, trip_id, payload, get_place_search_service()),
            lambda x: _model(x, schemas.PlaceSearchResponse),
        )

    def reverse_geocode_place(self, trip_id: str, payload: schemas.PlaceReverseGeocodeRequest) -> dict[str, Any]:
        """Explicitly request a coordinate-to-place suggestion; this never writes canonical data."""
        from ..places.search import get_place_search_service

        return self._call(
            "place.reverse",
            "place_search",
            None,
            trip_id,
            lambda s, sub: place_service.reverse_geocode_place(s, sub, trip_id, payload, get_place_search_service()),
            lambda x: _model(x, schemas.PlaceSearchResponse),
        )

    def list_locations(self, trip_id: str, compact: bool = True) -> list[dict[str, Any]]:
        """List owner-only locations. Compact rows keep the ids, names and area id; pass compact=false for addresses, coordinates and provider fields."""
        return self._call(
            "location.list",
            "location",
            None,
            trip_id,
            lambda s, sub: location_service.list_locations(s, sub, trip_id),
            _listed("location", schemas.LocationResponse, compact),
        )

    def save_location(self, trip_id: str, payload: schemas.LocationInput) -> dict[str, Any]:
        """Save a selected location for this trip."""
        return self._call(
            "location.create",
            "location",
            None,
            trip_id,
            lambda s, sub: location_service.save_location(s, sub, trip_id, payload),
            lambda x: _model(x, schemas.LocationResponse),
        )

    def list_areas(self, trip_id: str, query: str | None = None, compact: bool = True) -> list[dict[str, Any]]:
        """List areas: the cities and regions you authored. query keeps only areas whose label contains it (case-insensitive), to find an area id by name. Pass compact=false for coordinates."""

        return self._call(
            "area.list",
            "area",
            None,
            trip_id,
            lambda s, sub: area_service.list_areas(s, sub, trip_id, q=(query or "").strip() or None),
            _listed("area", schemas.AreaResponse, compact),
        )

    def suggest_area(self, trip_id: str, payload: schemas.AreaSuggestRequest) -> dict[str, Any]:
        """Suggest a nearby area or a new generalized area from coordinates; never saves it."""
        from ..places.search import get_place_search_service

        return self._call(
            "area.suggest",
            "area",
            None,
            trip_id,
            lambda s, sub: area_service.suggest_area(s, sub, trip_id, payload, get_place_search_service()),
            lambda x: _model(x, schemas.AreaSuggestion),
        )

    def save_area(self, trip_id: str, payload: schemas.AreaInput) -> dict[str, Any]:
        """Save an area without making it public."""
        return self._call(
            "area.create",
            "area",
            None,
            trip_id,
            lambda s, sub: area_service.save_area(s, sub, trip_id, payload),
            lambda x: _model(x, schemas.AreaResponse),
        )

    def update_area(self, trip_id: str, area_id: str, payload: schemas.AreaUpdate) -> dict[str, Any]:
        """Edit an area, for example to set its IANA time zone."""
        return self._call(
            "area.update",
            "area",
            area_id,
            trip_id,
            lambda s, sub: area_service.update_area(s, sub, trip_id, area_id, payload),
            lambda x: _model(x, schemas.AreaResponse),
        )

    def delete_area(self, trip_id: str, area_id: str, confirm: bool = False) -> dict[str, str]:
        """Delete an unused area after explicit confirmation. Refused while a visit, reisupdate, location or route still uses it: move or merge those first."""
        return self._call(
            "area.delete",
            "area",
            area_id,
            trip_id,
            lambda s, sub: area_service.delete_area(s, sub, trip_id, area_id),
            lambda _: {"status": "deleted"},
            confirm=confirm,
            needs_confirmation=True,
        )

    def merge_areas(
        self,
        trip_id: str,
        keep_id: str,
        duplicate_ids: list[str],
        confirm: bool = False,
        confirm_widening: bool = False,
        make_private: list[schemas.MergeRecordRef] | None = None,
    ) -> dict[str, Any]:
        """Fold duplicate areas into keep_id: every location, visit, route end and reisupdate filed under a duplicate moves to keep_id (a stay, filed under an area alone or at a location, moves along), then the duplicates are deleted, in one transaction. keep_id keeps its label, point, time zone and visibility. Without confirm=true it only previews the counts per duplicate, warns when a duplicate reaches an audience the kept area does not, and lists city_level_location_ids: locations that only name the city and would then be duplicates, to fold with merge_locations afterwards. Review that preview, then repeat with confirm=true. When a live audience receives the kept area but not a duplicate, the moved records start to show them the kept area's rounded point: the preview lists those audiences per duplicate (widened: audience as public or link:<id>, with counts of stays, visits, routes and travel_updates), and confirm=true alone is then refused with a JSON review (code merge_widening_needs_acknowledgement). Show it to the owner; repeat with confirm=true and confirm_widening=true only after they accept. To avoid it, either make the kept area private first (set_visibility), or choose per record: the preview lists each newly shown stay, visit, route and reisupdate in widened_records (kind, id, label, starts_on, visibility, the audiences it newly reaches, hides_from: the audiences that read it today and would lose it, custom_picks: custom scopes that list it and drop it for good). Pass make_private=[{{"kind": "stay", "id": "..."}}, ...] with only the records the owner chose to hide: they are made private first (hidden from every audience, not only the widened ones, and removed from custom scopes), and only the rest still needs confirm_widening. A record the preview does not list is refused (code merge_private_choice_is_stale) with nothing changed; preview again. Never hide a record the owner did not choose. The accepted widening and the chosen record ids are recorded in the audit trail."""
        payload = schemas.MergeRequest(
            keep_id=keep_id,
            duplicate_ids=duplicate_ids,
            confirm=confirm,
            confirm_widening=confirm_widening,
            make_private=make_private or [],
        )
        return self._call(
            "area.merge" if confirm else "area.merge_preview",
            "area",
            keep_id,
            trip_id,
            lambda s, sub: area_service.merge_areas(s, sub, trip_id, payload),
        )

    def delete_location(self, trip_id: str, location_id: str, confirm: bool = False) -> dict[str, str]:
        """Delete an unused location after explicit confirmation. Refused, naming what still uses it, while a visit, stay, route or reisupdate points at it; use merge_locations to fold a duplicate into another location instead."""
        return self._call(
            "location.delete",
            "location",
            location_id,
            trip_id,
            lambda s, sub: location_service.delete_location(s, sub, trip_id, location_id),
            lambda _: {"status": "deleted"},
            confirm=confirm,
            needs_confirmation=True,
        )

    def merge_locations(
        self,
        trip_id: str,
        keep_id: str,
        duplicate_ids: list[str],
        confirm: bool = False,
        confirm_widening: bool = False,
        make_private: list[schemas.MergeRecordRef] | None = None,
    ) -> dict[str, Any]:
        """Merge duplicate locations (locaties samenvoegen) into keep_id: every visit, stay, route end and reisupdate at a duplicate moves to keep_id, then the duplicates are deleted, in one transaction. Without confirm=true it only previews the counts per duplicate and warns when a duplicate reaches an audience the kept location does not (the merge keeps keep_id's name, visibility and area). Review that preview, then repeat with confirm=true. When a live audience receives the kept location but not a duplicate, the moved records start to show them the kept location's name and point: the preview lists those audiences per duplicate (widened: audience as public or link:<id>, with counts of stays, visits, routes and travel_updates), and confirm=true alone is then refused with a JSON review (code merge_widening_needs_acknowledgement). Show it to the owner; repeat with confirm=true and confirm_widening=true only after they accept. To avoid it, either make the kept location private first (set_visibility), or choose per record: the preview lists each newly shown stay, visit, route and reisupdate in widened_records (kind, id, label, starts_on, visibility, the audiences it newly reaches, hides_from: the audiences that read it today and would lose it, custom_picks: custom scopes that list it and drop it for good). Pass make_private=[{{"kind": "stay", "id": "..."}}, ...] with only the records the owner chose to hide: they are made private first (hidden from every audience, not only the widened ones, and removed from custom scopes), and only the rest still needs confirm_widening. A record the preview does not list is refused (code merge_private_choice_is_stale) with nothing changed; preview again. Never hide a record the owner did not choose. The accepted widening and the chosen record ids are recorded in the audit trail."""
        payload = schemas.MergeRequest(
            keep_id=keep_id,
            duplicate_ids=duplicate_ids,
            confirm=confirm,
            confirm_widening=confirm_widening,
            make_private=make_private or [],
        )
        return self._call(
            "location.merge" if confirm else "location.merge_preview",
            "location",
            keep_id,
            trip_id,
            lambda s, sub: location_service.merge_locations(s, sub, trip_id, payload),
        )

    def update_location(self, trip_id: str, location_id: str, payload: schemas.LocationUpdate) -> dict[str, Any]:
        """Give a location its public name (a location cannot be shared without one), move it to another area (its routes, visits and stays move along), or geocode it in place: after search_places, verify the match and send its latitude and longitude, viewport edges, osm_element_type and osm_element_id (the OSM link follows the element) and navigation provider fields. The id and every visit, stay, route end and reisupdate keep pointing at it; visibility never changes. Omitted fields keep their value and null clears one; latitude/longitude, the four viewport edges and the OSM type/id are each set or cleared together. Moving an existing point needs the new place's OSM, viewport and provider fields too (null the ones that no longer apply), and a shared location must be made private first, because a shared location publishes its point. Changing what visitors read (the public name, city, country, a shared address, or the area, which moves its visits, stays and route ends) on a location with live receivers is refused with a JSON review (code visitor_visible_change_needs_acknowledgement: each field's before and after and the audiences that see it, as public or link:<id>). Show it to the owner; repeat the same update with acknowledge_visitor_changes=true only after they accept. An acknowledged change is recorded in the audit trail."""
        return self._call(
            "location.update",
            "location",
            location_id,
            trip_id,
            lambda s, sub: location_service.update_location(s, sub, trip_id, location_id, payload),
            lambda x: _model(x, schemas.LocationResponse),
        )

    def set_visibility(
        self, trip_id: str, kind: schemas.ShareScopeKind, record_id: str, visibility: Visibility, confirm: bool = False
    ) -> dict[str, Any]:
        """Choose who can see one record (its zichtbaarheid): private, everyone, or custom (only audiences that list it)."""
        kind, visibility = schemas.ShareScopeKind(kind), Visibility(visibility)
        return self._call(
            "visibility.set",
            kind.value,
            record_id,
            trip_id,
            lambda s, sub: visibility_service.put_visibility(s, sub, trip_id, kind.value, record_id, visibility),
            lambda chosen: schemas.VisibilityUpdate(visibility=chosen).model_dump(mode="json"),
            confirm=confirm,
            needs_confirmation=True,
        )

    def get_location_navigation(self, trip_id: str, location_id: str) -> dict[str, Any]:
        """Resolve an owned location to its authorized navigation URL."""
        return self._call(
            "location.navigation",
            "location",
            location_id,
            trip_id,
            lambda s, sub: location_service.owner_navigation(s, sub, trip_id, location_id),
            lambda x: _model(x, schemas.NavigationResponse),
        )
