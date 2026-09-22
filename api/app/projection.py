"""Server-side audience projection rendering.

A projection is built directly from an explicit scope (the owner-selected
resource ids and fields) against the *current* canonical trip: only the scope
decision is frozen at publish/activation time, so an already-approved item's
content (a wording fix, an updated time) is reflected immediately, while the
renderer never returns a resource or field the scope did not name, so an
out-of-scope item stays absent rather than merely hidden by a client.
"""

from .models import Trip


class ScopeError(ValueError):
    """The scope references a resource outside this trip."""


def validate_scope(trip: Trip, scope: dict) -> None:
    stage_ids = {stage.id for stage in trip.route_stages}
    moment_ids = {moment.id for moment in trip.moments}
    for stage_id in scope.get("route_stage_ids", []):
        if stage_id not in stage_ids:
            raise ScopeError(f"Route stage {stage_id} is not part of this trip")
    for moment_id in scope.get("moment_ids", []):
        if moment_id not in moment_ids:
            raise ScopeError(f"Moment {moment_id} is not part of this trip")


def render_projection(trip: Trip, scope: dict, schema_version: str) -> dict:
    stage_ids = set(scope.get("route_stage_ids", []))
    moment_ids = set(scope.get("moment_ids", []))
    return {
        "schema_version": schema_version,
        "title": trip.title if scope.get("include_title", True) else None,
        "summary": trip.summary if scope.get("include_summary", True) else None,
        "route_stages": [
            {
                "id": stage.id,
                "position": stage.position,
                "label": stage.label,
                "place": {
                    "label": stage.place.label,
                    "country_code": stage.place.country_code,
                    "region": stage.place.region,
                },
            }
            for stage in trip.route_stages
            if stage.id in stage_ids
        ],
        "moments": [
            {
                "id": moment.id,
                "occurred_at": moment.occurred_at.isoformat(),
                "title": moment.title,
                "story": moment.story,
                "photo_urls": list(moment.photo_urls),
                # A moment's place is always `exact` (address, coordinates,
                # notes) per the canonical model, so it can never be
                # projected here; a shared place instead comes from a
                # separately authored `moment_excerpt.broad_place_id`
                # (still owner-only scope wiring, not yet in this contract).
                "place": None,
            }
            for moment in trip.moments
            if moment.id in moment_ids
        ],
    }
