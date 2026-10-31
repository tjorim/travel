"""What an owner edit to a shared place changes for the audiences that receive it.

The owner decided (#32) that a visitor-facing change to a location with live
receivers is allowed, but only once the owner has seen what changes and for
whom. These helpers compute that review from the same projection rules the
visitor views use, so the location editor, the MCP tool and the merge preview
(#27) agree on what is visitor-facing and who reaches it.
"""

from dataclasses import dataclass
from typing import Any

from .access import receivers
from .audit import LiveAudience
from .models import Location

# Location fields a visitor can read, in display order. The address parts are
# published only while the owner shares the address; ``locality`` is the region
# either way.
ALWAYS_VISIBLE = ("label", "locality", "country_code")
ADDRESS_FIELDS = ("address_line1", "address_line2", "postal_code", "admin_area")


@dataclass(frozen=True)
class FieldChange:
    """One visitor-facing change: the field, its value before and after, and who sees it."""

    field: str
    before: Any
    after: Any
    audiences: list[LiveAudience]
    # An area move also names the area labels and how many records ride along.
    before_label: str | None = None
    after_label: str | None = None
    visits: int = 0
    routes: int = 0

    def as_detail(self) -> dict[str, Any]:
        """The owner-facing description of the change; the audiences carry no scope."""
        detail: dict[str, Any] = {
            "field": self.field,
            "before": self.before,
            "after": self.after,
            "audiences": [{"id": audience.id, "label": audience.label} for audience in self.audiences],
        }
        if self.field == "area_id":
            detail |= {
                "before_label": self.before_label,
                "after_label": self.after_label,
                "visits": self.visits,
                "routes": self.routes,
            }
        return detail

    def as_audit(self) -> dict[str, Any]:
        """What the audit trail keeps: the field and audience ids, never the text itself."""
        entry: dict[str, Any] = {"field": self.field, "audiences": sorted(audience.id for audience in self.audiences)}
        if self.field == "area_id":
            entry |= {"visits": self.visits, "routes": self.routes}
        return entry


def location_visitor_view(location: Location) -> dict[str, str | None]:
    """The text fields of a location as visitors would read them now; an unshared address is absent."""
    fields = ALWAYS_VISIBLE + (ADDRESS_FIELDS if location.share_address else ())
    return {name: getattr(location, name) for name in fields}


def text_changes(
    before: dict[str, str | None], after: dict[str, str | None], audiences: list[LiveAudience]
) -> list[FieldChange]:
    """Fields whose visitor-readable value differs: sharing the address counts as adding its parts."""
    if not audiences:
        return []
    return [
        FieldChange(name, before.get(name), after.get(name), audiences)
        for name in ALWAYS_VISIBLE + ADDRESS_FIELDS
        if before.get(name) != after.get(name)
    ]


def reached_by(kind: str, record: Any, live: list[LiveAudience]) -> list[LiveAudience]:
    """The live audiences that receive this record by the rule delivery applies."""
    reached = receivers(kind, record, [(audience.id, audience.scope) for audience in live])
    return [audience for audience in live if audience.id in reached]
