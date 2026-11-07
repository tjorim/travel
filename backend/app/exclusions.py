"""What a hidden link or a collection member subtracts from the public baseline.

Every audience starts from the baseline: the records set to ``everyone``. A hidden link or a collection
member may *exclude* individual baseline records through ``exclude`` in its share scope, in addition to
the ``custom`` records it lists. Subtraction only ever removes: nothing outside an audience's allowlist
is delivered, and an exclusion can never reveal a field.

A record that points at an excluded one would otherwise leave a dangling reference in the delivered
document (a visit names its area, a stay its area and maybe its location, a photo its update), so one conservative rule
applies, computed here and nowhere else:

    Excluding a record also hides, for that audience only, every record that depends on it.

* an **area** hides the locations filed under it, and through them everything below;
* a **location** hides the visits, stays, routes and updates that use it;
* an **area** also hides the visits, stays, routes and updates that name it;
* an **update** hides the photos attached to it;
* a **photo** hides only itself, and when it is the trip cover the audience simply gets no cover.

The cascade applies to every record the audience would otherwise receive, ``custom`` ones included: an
exclusion is the owner's statement that this audience must not read about the record.

The public view is the baseline and has no exclusions. A stored exclusion that no longer applies (the
record is gone, or no longer ``everyone``) is ignored, and a write prunes it.
"""

from dataclasses import dataclass, field
from typing import Any

from .access import COLLECTIONS
from .models import Trip, Visibility

EXCLUDE_KEY = "exclude"
# Kinds in the order the cascade resolves them; also the order counts are reported in.
KIND_ORDER = ("area", "location", "visit", "stay", "route", "travel_update", "media_derivative")


def stored_exclusions(scope: dict) -> list[tuple[str, str]]:
    """The ``(kind, id)`` pairs a scope lists, in order and without duplicates; anything malformed is skipped."""
    found: dict[tuple[str, str], None] = {}
    entries = scope.get(EXCLUDE_KEY)
    for entry in entries if isinstance(entries, list) else ():
        if isinstance(entry, dict) and entry.get("kind") in COLLECTIONS and isinstance(entry.get("id"), str):
            found[(entry["kind"], entry["id"])] = None
    return list(found)


def is_excludable(trip: Trip, kind: str, record: Any) -> bool:
    """Whether the public baseline can reach this record, so that an audience may subtract it.

    That is a record set to ``everyone``, or a photo attached to an ``everyone`` update (it travels with
    the update). Whether it is deliverable right now does not matter: an exclusion must keep holding
    when a cancelled visit is planned again or a stay idea becomes a stay."""
    if record.visibility == Visibility.EVERYONE:
        return True
    if kind == "media_derivative" and record.travel_update_id is not None:
        update = next((item for item in trip.travel_updates if item.id == record.travel_update_id), None)
        return update is not None and update.visibility == Visibility.EVERYONE
    return False


@dataclass(frozen=True)
class Hidden:
    """The records one scope hides, by kind: the ones it excludes, and the ones that only depend on them."""

    explicit: dict[str, set[str]] = field(default_factory=dict)
    cascaded: dict[str, set[str]] = field(default_factory=dict)

    def ids(self, kind: str) -> set[str]:
        return self.explicit.get(kind, set()) | self.cascaded.get(kind, set())

    def __contains__(self, ref: tuple[str, str | None]) -> bool:
        kind, record_id = ref
        return record_id in self.explicit.get(kind, ()) or record_id in self.cascaded.get(kind, ())

    def __bool__(self) -> bool:
        return any(self.explicit.values()) or any(self.cascaded.values())


NOTHING = Hidden()


def _touches(areas: set[str], locations: set[str], area_ids: list[str | None], location_ids: list[str | None]) -> bool:
    return any(item in areas for item in area_ids if item) or any(item in locations for item in location_ids if item)


def closure(trip: Trip, seeds: dict[str, set[str]]) -> dict[str, set[str]]:
    """Every record hidden when ``seeds`` are, seeds included. Deterministic: it depends only on the trip's records."""
    areas = set(seeds.get("area", ()))
    locations = set(seeds.get("location", ())) | {item.id for item in trip.locations if item.area_id in areas}
    visits = set(seeds.get("visit", ())) | {
        item.id
        for item in trip.visits
        if _touches(areas, locations, [item.area_id], [item.location_id])
        or (item.location is not None and item.location.area_id in areas)
    }
    stays = set(seeds.get("stay", ())) | {
        item.id for item in trip.stays if _touches(areas, locations, [item.area_id], [item.location_id])
    }
    routes = set(seeds.get("route", ())) | {
        item.id
        for item in trip.routes
        if _touches(
            areas,
            locations,
            [item.departure_area_id, item.arrival_area_id],
            [item.departure_location_id, item.arrival_location_id],
        )
    }
    updates = set(seeds.get("travel_update", ())) | {
        item.id
        for item in trip.travel_updates
        if _touches(
            areas,
            locations,
            [item.area_id, item.location.area_id if item.location is not None else None],
            [item.location_id],
        )
    }
    media = set(seeds.get("media_derivative", ())) | {
        item.id for item in trip.media_derivatives if item.travel_update_id in updates
    }
    return {
        "area": areas,
        "location": locations,
        "visit": visits,
        "stay": stays,
        "route": routes,
        "travel_update": updates,
        "media_derivative": media,
    }


def effective_exclusions(trip: Trip, scope: dict) -> dict[str, set[str]]:
    """The stored exclusions that still apply: the record exists on this trip and the baseline reaches it."""
    chosen = stored_exclusions(scope)
    if not chosen:
        return {}
    effective: dict[str, set[str]] = {}
    for kind, record_id in chosen:
        record = next((item for item in COLLECTIONS[kind](trip) if item.id == record_id), None)
        if record is not None and is_excludable(trip, kind, record):
            effective.setdefault(kind, set()).add(record_id)
    return effective


def hidden_records(trip: Trip, scope: dict) -> Hidden:
    """The records this scope hides from its audience; ``NOTHING`` for every scope without ``exclude``."""
    seeds = effective_exclusions(trip, scope)
    if not seeds:
        return NOTHING
    everything = closure(trip, seeds)
    return Hidden(
        explicit=seeds,
        cascaded={
            kind: ids - seeds.get(kind, set()) for kind, ids in everything.items() if ids - seeds.get(kind, set())
        },
    )
