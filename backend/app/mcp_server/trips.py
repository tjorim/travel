"""Trip tools, including the all-or-nothing batch of records."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import schemas
from ..errors import Refusal, ServiceError
from ..services import routes as route_service
from ..services import stays as stay_service
from ..services import tasks as task_service
from ..services import travel_updates as update_service
from ..services import trips as trip_service
from ..services import visits as visit_service
from .core import McpTools
from .rendering import _compact, _model, _models


class BatchCreate(schemas.InputModel):
    """Records to add to one trip in a single all-or-nothing call, created in this order.

    Each list item takes exactly the payload of its single ``create_*`` tool.
    """

    visits: list[schemas.VisitCreate] = Field(default_factory=list, max_length=100)
    stays: list[schemas.StayCreate] = Field(default_factory=list, max_length=100)
    routes: list[schemas.RouteCreate] = Field(default_factory=list, max_length=100)
    travel_updates: list[schemas.TravelUpdateCreate] = Field(default_factory=list, max_length=100)
    trip_tasks: list[schemas.TripTaskCreate] = Field(default_factory=list, max_length=100)


class TripTools(McpTools):
    """Trip tools, including the all-or-nothing batch of records."""

    def list_trips(self) -> list[dict[str, Any]]:
        """List the caller's private trips (newest first, at most 100) as summaries: title, dates and cover, how many travel updates each has and when the newest happened, without the updates themselves. list_travel_updates reads a trip's updates."""
        return self._call(
            "trip.list",
            "trip",
            None,
            None,
            lambda s, sub: trip_service.list_trips(s, sub),
            lambda x: _models(x, schemas.TripSummaryResponse),
        )

    def create_trip(self, payload: schemas.TripCreate) -> dict[str, Any]:
        """Create a private trip."""
        return self._call(
            "trip.create",
            "trip",
            None,
            None,
            lambda s, sub: trip_service.create_trip(s, sub, payload),
            lambda x: _model(x, schemas.TripResponse),
        )

    def get_trip(self, trip_id: str) -> dict[str, Any]:
        """Read one owned trip: title, summary, dates and cover."""
        return self._call(
            "trip.get",
            "trip",
            trip_id,
            trip_id,
            lambda s, sub: trip_service.get_trip(s, sub, trip_id),
            lambda x: _model(x, schemas.TripResponse),
        )

    def get_trip_overview(self, trip_id: str) -> dict[str, Any]:
        """Check a trip in one read: counts per kind, including visits_undated and routes_undated (to compare with a source such as an archive file), visibility per kind, what the public page and each draft or active link receive, and warnings to review before sharing (an active audience receiving nothing, shared trip dates, planning words like "concept" in a visible label, records without a map point because their area is not shared, undated visits duplicating dated ones)."""
        return self._call(
            "trip.overview",
            "trip",
            trip_id,
            trip_id,
            lambda s, sub: trip_service.get_trip_overview(s, sub, trip_id),
            lambda x: _model(x, schemas.TripOverviewResponse),
        )

    def batch_create(self, trip_id: schemas.Identifier, payload: BatchCreate) -> dict[str, list[dict[str, Any]]]:
        """Create several visits, stays, routes, reisupdates and tasks at once in an existing trip, in one call. All or nothing: if any record is refused, none is kept and the error names it (for example routes[3]). Returns compact rows with the new ids."""
        steps: list[tuple[str, str, Callable[[Session, str, Any], Any], type[BaseModel]]] = [
            (
                "visits",
                "visit",
                lambda s, sub, item: visit_service.create_visit(s, sub, trip_id, item),
                schemas.VisitResponse,
            ),
            (
                "stays",
                "stay",
                lambda s, sub, item: stay_service.create_stay(s, sub, trip_id, item),
                schemas.StayResponse,
            ),
            (
                "routes",
                "route",
                lambda s, sub, item: route_service.create_route(s, sub, trip_id, item),
                schemas.RouteResponse,
            ),
            (
                "travel_updates",
                "",
                lambda s, sub, item: update_service.create_travel_update(s, sub, trip_id, item),
                schemas.TravelUpdateResponse,
            ),
            (
                "trip_tasks",
                "",
                lambda s, sub, item: task_service.create_trip_task(s, sub, trip_id, item),
                schemas.TripTaskResponse,
            ),
        ]

        def operation(session: Session, subject: str) -> dict[str, list[dict[str, Any]]]:
            # The services never commit, so the whole batch is one transaction: ``_call`` commits it at the
            # end, and the closing session rolls all of it back when one record is refused.
            created: dict[str, list[dict[str, Any]]] = {}
            for field, kind, create, model_type in steps:
                rows = []
                for index, item in enumerate(getattr(payload, field)):
                    try:
                        row = _model(create(session, subject, item), model_type)
                    except ServiceError as error:
                        raise Refusal(
                            f"{field}[{index}]: {error}. Nothing was created.",
                            code=error.code,
                            params=error.params,
                            field=error.field,
                        ) from error
                    rows.append(_compact(kind, row) if kind else {"id": row["id"], "title": row["title"]})
                if rows:
                    created[field] = rows
            return created

        return self._call("trip.batch_create", "trip", trip_id, trip_id, operation, lambda x: x)

    def update_trip(self, trip_id: str, payload: schemas.TripUpdate) -> dict[str, Any]:
        """Update an owned trip's private metadata."""
        return self._call(
            "trip.update",
            "trip",
            trip_id,
            trip_id,
            lambda s, sub: trip_service.update_trip(s, sub, trip_id, payload),
            lambda x: _model(x, schemas.TripResponse),
        )

    def delete_trip(self, trip_id: str, confirm: bool = False) -> dict[str, str]:
        """Permanently delete an owned trip after explicit confirmation."""
        return self._call(
            "trip.delete",
            "trip",
            trip_id,
            trip_id,
            lambda s, sub: trip_service.delete_trip(s, sub, trip_id),
            lambda _: {"status": "deleted"},
            confirm=confirm,
            needs_confirmation=True,
        )
