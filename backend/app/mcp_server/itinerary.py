"""Visits, travel updates, stays and routes."""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import Field

from .. import schemas
from ..services import routes as route_service
from ..services import stays as stay_service
from ..services import travel_updates as update_service
from ..services import visits as visit_service
from .core import McpTools
from .rendering import _listed, _model, _models


class ItineraryTools(McpTools):
    """Visits, travel updates, stays and routes."""

    def list_visits(self, trip_id: schemas.Identifier, compact: bool = True) -> list[dict[str, Any]]:
        """List the trip's visits (stops) in order. Compact rows name the area and location by id; pass compact=false, or use get_visit, for the full records."""
        return self._call(
            "visit.list",
            "visit",
            None,
            trip_id,
            lambda s, sub: visit_service.list_visits(s, sub, trip_id),
            _listed("visit", schemas.VisitResponse, compact),
        )

    def get_visit(self, trip_id: schemas.Identifier, visit_id: schemas.Identifier) -> dict[str, Any]:
        """Read one visit."""
        return self._call(
            "visit.get",
            "visit",
            visit_id,
            trip_id,
            lambda s, sub: visit_service.get_visit(s, sub, trip_id, visit_id),
            lambda x: _model(x, schemas.VisitResponse),
        )

    def create_visit(self, trip_id: schemas.Identifier, payload: schemas.VisitCreate) -> dict[str, Any]:
        """Create a visit: an area, or a location in one, with optional days, times, kind and notes. The visit status (idea, planned, confirmed or cancelled) is owner-only and never shared: keep planning state there, not in a title or area label, and cancel a rejected idea instead of deleting it. A cancelled visit can never be shared. Times stay private unless share_time is set. share_date_precision (day, month, year or null) caps how precisely visitors read the days; null, the default, follows each audience's own date precision and the coarser of the two applies. Visits replace the archive's route stages and day-plan steps; summary is the visitor text (a highlight). notes and summary are Markdown."""
        return self._call(
            "visit.create",
            "visit",
            None,
            trip_id,
            lambda s, sub: visit_service.create_visit(s, sub, trip_id, payload),
            lambda x: _model(x, schemas.VisitResponse),
        )

    def update_visit(
        self, trip_id: schemas.Identifier, visit_id: schemas.Identifier, payload: schemas.VisitUpdate
    ) -> dict[str, Any]:
        """Edit or reorder a visit. share_date_precision: null follows the audience's date precision, day/month/year caps this visit's days; omit it to keep the value."""
        return self._call(
            "visit.update",
            "visit",
            visit_id,
            trip_id,
            lambda s, sub: visit_service.update_visit(s, sub, trip_id, visit_id, payload),
            lambda x: _model(x, schemas.VisitResponse),
        )

    def delete_visit(
        self, trip_id: schemas.Identifier, visit_id: schemas.Identifier, confirm: bool = False
    ) -> dict[str, str]:
        """Delete a visit after explicit confirmation."""
        return self._call(
            "visit.delete",
            "visit",
            visit_id,
            trip_id,
            lambda s, sub: visit_service.delete_visit(s, sub, trip_id, visit_id),
            lambda _: {"status": "deleted"},
            confirm=confirm,
            needs_confirmation=True,
        )

    def create_travel_update(self, trip_id: schemas.Identifier, payload: schemas.TravelUpdateCreate) -> dict[str, Any]:
        """Create a travel update, a new reisupdate (reisupdate schrijven): private notes, location and attached media stay private; the title, text, date and area are shared only as its visibility allows. Reisupdates replace the archive's story moments and excerpts: body is the visitor text. body and private_notes are Markdown."""
        return self._call(
            "travel_update.create",
            "travel_update",
            None,
            trip_id,
            lambda s, sub: update_service.create_travel_update(s, sub, trip_id, payload),
            lambda x: _model(x, schemas.TravelUpdateResponse),
        )

    def list_travel_updates(
        self,
        trip_id: schemas.Identifier,
        query: str | None = None,
        latest: Annotated[int | None, Field(ge=1, le=100)] = None,
    ) -> list[dict[str, Any]]:
        """List a trip's travel updates (reisupdates) in chronological order, oldest first; query filters by title. Pass latest=N for only the newest N (still oldest first). Each row has the private notes, the visitor text, the area or location and the attached media."""
        return self._call(
            "travel_update.list",
            "travel_update",
            None,
            trip_id,
            lambda s, sub: update_service.list_travel_updates(s, sub, trip_id, q=query, latest=latest),
            lambda x: _models(x, schemas.TravelUpdateResponse),
        )

    def update_travel_update(
        self, trip_id: schemas.Identifier, update_id: schemas.Identifier, payload: schemas.TravelUpdatePatch
    ) -> dict[str, Any]:
        """Edit a reisupdate, including who may see it (private, everyone or custom)."""
        return self._call(
            "travel_update.update",
            "travel_update",
            update_id,
            trip_id,
            lambda s, sub: update_service.update_travel_update(s, sub, trip_id, update_id, payload),
            lambda x: _model(x, schemas.TravelUpdateResponse),
        )

    def delete_travel_update(
        self, trip_id: schemas.Identifier, update_id: schemas.Identifier, confirm: bool = False
    ) -> dict[str, str]:
        """Delete a reisupdate after explicit confirmation."""
        return self._call(
            "travel_update.delete",
            "travel_update",
            update_id,
            trip_id,
            lambda s, sub: update_service.delete_travel_update(s, sub, trip_id, update_id),
            lambda _: {"status": "deleted"},
            confirm=confirm,
            needs_confirmation=True,
        )

    def list_stays(self, trip_id: schemas.Identifier, compact: bool = True) -> list[dict[str, Any]]:
        """List owner-only accommodation records. A stay with status idea is a candidate under comparison, not part of the plan. Compact rows name the area and the location by id (location_id is null while the accommodation is not chosen yet); pass compact=false, or use get_stay, for booking and contact details and the attached documents (document_asset_ids)."""
        return self._call(
            "stay.list",
            "stay",
            None,
            trip_id,
            lambda s, sub: stay_service.list_stays(s, sub, trip_id),
            _listed("stay", schemas.StayResponse, compact),
        )

    def create_stay(self, trip_id: schemas.Identifier, payload: schemas.StayCreate) -> dict[str, Any]:
        """Add a hotel or other accommodation stay (verblijf toevoegen), private, with check-in and check-out dates; omit local times until verified. A stay has an area and an optional location: while the accommodation is undecided give only area_id, and the stay is filed under that area with no location (nothing is created for it). A location settles the area; an area given with it must be its own. notes is Markdown; contact_details is plain text whose phone numbers, email and web addresses are linked. To keep a booking confirmation with its stay, upload it with upload_document and pass the document's id in document_asset_ids (owner-only; a document is never shared)."""
        return self._call(
            "stay.create",
            "stay",
            None,
            trip_id,
            lambda s, sub: stay_service.create_stay(s, sub, trip_id, payload),
            lambda x: _model(x, schemas.StayResponse),
        )

    def update_stay(
        self, trip_id: schemas.Identifier, stay_id: schemas.Identifier, payload: schemas.StayUpdate
    ) -> dict[str, Any]:
        """Update a private stay; set check_in_time/check_out_time to null to clear unverified times. Choose the accommodation later with a location; set location to null to return to "accommodation not chosen yet" (the area is kept); area_id alone moves the stay to that area and keeps its location only when it is already there. Move the chosen candidate from idea to planned or confirmed and cancel or delete the rejected alternatives. share_date_precision: null follows the audience's date precision, day/month/year caps the stay's nights; omit it to keep the value. document_asset_ids replaces the attached documents (the full list; [] detaches all); omit it to keep them."""
        return self._call(
            "stay.update",
            "stay",
            stay_id,
            trip_id,
            lambda s, sub: stay_service.update_stay(s, sub, trip_id, stay_id, payload),
            lambda x: _model(x, schemas.StayResponse),
        )

    def delete_stay(
        self, trip_id: schemas.Identifier, stay_id: schemas.Identifier, confirm: bool = False
    ) -> dict[str, str]:
        """Delete an accommodation record after explicit confirmation."""
        return self._call(
            "stay.delete",
            "stay",
            stay_id,
            trip_id,
            lambda s, sub: stay_service.delete_stay(s, sub, trip_id, stay_id),
            lambda _: {"status": "deleted"},
            confirm=confirm,
            needs_confirmation=True,
        )

    def list_routes(self, trip_id: schemas.Identifier, compact: bool = True) -> list[dict[str, Any]]:
        """List routes: how the trip gets from one area to another, ordered by departs_on (the local departure day; a route can have a day before it has times). Compact rows name the ends by id and label and leave out the line, notes and bookings; pass compact=false, or use get_route, for the full records."""
        return self._call(
            "route.list",
            "route",
            None,
            trip_id,
            lambda s, sub: route_service.list_routes(s, sub, trip_id),
            _listed("route", schemas.RouteResponse, compact),
        )

    def create_route(self, trip_id: schemas.Identifier, payload: schemas.RouteCreate) -> dict[str, Any]:
        """Create a route between two areas with a travel mode (flight, train, bus, ferry, car, bike, walk or other). A day first, times optional: "on 5 December, no train yet" is departs_on alone; never invent a time or put the date in the label. The exact locations, schedule, booking details and a drawn GeoJSON line are optional."""
        return self._call(
            "route.create",
            "route",
            None,
            trip_id,
            lambda s, sub: route_service.create_route(s, sub, trip_id, payload),
            lambda x: _model(x, schemas.RouteResponse),
        )

    def update_route(
        self, trip_id: schemas.Identifier, route_id: schemas.Identifier, payload: schemas.RouteUpdate
    ) -> dict[str, Any]:
        """Update a route. Set departs_on to give it a day without times; add departs_at and arrives_at together later (its day must stay the local date of departs_at), or set both to null to go back to a day only."""
        return self._call(
            "route.update",
            "route",
            route_id,
            trip_id,
            lambda s, sub: route_service.update_route(s, sub, trip_id, route_id, payload),
            lambda x: _model(x, schemas.RouteResponse),
        )

    def delete_route(
        self, trip_id: schemas.Identifier, route_id: schemas.Identifier, confirm: bool = False
    ) -> dict[str, str]:
        """Delete a route after explicit confirmation."""
        return self._call(
            "route.delete",
            "route",
            route_id,
            trip_id,
            lambda s, sub: route_service.delete_route(s, sub, trip_id, route_id),
            lambda _: {"status": "deleted"},
            confirm=confirm,
            needs_confirmation=True,
        )

    def get_stay(self, trip_id: schemas.Identifier, stay_id: schemas.Identifier) -> dict[str, Any]:
        """Read one owner-only accommodation record, including the ids of its attached documents (document_asset_ids)."""
        return self._call(
            "stay.get",
            "stay",
            stay_id,
            trip_id,
            lambda s, sub: stay_service.get_stay(s, sub, trip_id, stay_id),
            lambda x: _model(x, schemas.StayResponse),
        )

    def get_route(self, trip_id: schemas.Identifier, route_id: schemas.Identifier) -> dict[str, Any]:
        """Read one route."""
        return self._call(
            "route.get",
            "route",
            route_id,
            trip_id,
            lambda s, sub: route_service.get_route(s, sub, trip_id, route_id),
            lambda x: _model(x, schemas.RouteResponse),
        )
