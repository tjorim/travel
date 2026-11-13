"""Alternative groups: competing ideas for the same nights, days or journey."""

from __future__ import annotations

from typing import Any

from .. import schemas
from ..services import alternatives as alternative_service
from .core import McpTools
from .rendering import _compact, _model


def _alternative_group(value: Any, compact: bool) -> dict[str, Any]:
    """An alternative group; compact keeps each member to the fields of a compact list row."""
    group = _model(value, schemas.AlternativeGroupResponse)
    if compact:
        for member in group["members"]:
            for kind in ("stay", "visit", "route"):
                member[kind] = _compact(kind, member[kind]) if member[kind] else None
    return group


class AlternativeTools(McpTools):
    """Alternative groups: competing ideas for the same nights, days or journey."""

    def list_alternative_groups(self, trip_id: str, compact: bool = True) -> list[dict[str, Any]]:
        """List the trip's alternative groups: private sets of stays, visits or routes being chosen between (kind says which), each with its members and the chosen one (chosen_id). Compact rows keep each member to ids, dates, status and labels; pass compact=false, or use get_alternative_group, to compare them in full. Groups are owner-only and never shared."""
        return self._call(
            "alternative_group.list",
            "alternative_group",
            None,
            trip_id,
            lambda s, sub: alternative_service.list_alternative_groups(s, sub, trip_id),
            lambda values: [_alternative_group(value, compact) for value in values],
        )

    def get_alternative_group(self, trip_id: str, group_id: str) -> dict[str, Any]:
        """Read one alternative group with every member in full (dates, exact location, notes, status), for comparing them side by side."""
        return self._call(
            "alternative_group.get",
            "alternative_group",
            group_id,
            trip_id,
            lambda s, sub: alternative_service.get_alternative_group(s, sub, trip_id, group_id),
            lambda x: _alternative_group(x, False),
        )

    def suggest_alternative_groups(self, trip_id: str) -> list[dict[str, Any]]:
        """Suggest alternative groups from ideas that are not grouped yet: stays whose nights overlap, multi-day visits that share a day, and routes between the same two areas on the same day. Nothing is stored and existing ideas are never grouped automatically: show a suggestion to the owner and, once they confirm it, pass its kind and member_ids to create_alternative_group."""
        return self._call(
            "alternative_group.suggest",
            "alternative_group",
            None,
            trip_id,
            lambda s, sub: alternative_service.suggest_alternative_groups(s, sub, trip_id),
            lambda values: [_model(value, schemas.AlternativeSuggestion) for value in values],
        )

    def create_alternative_group(self, trip_id: str, payload: schemas.AlternativeGroupCreate) -> dict[str, Any]:
        """Group two or more stays, visits or routes (all of one kind) that are alternatives for each other. A record is in at most one group. Members may have any status; choosing one later settles the rest."""
        return self._call(
            "alternative_group.create",
            "alternative_group",
            None,
            trip_id,
            lambda s, sub: alternative_service.create_alternative_group(s, sub, trip_id, payload),
            lambda x: _alternative_group(x, True),
        )

    def update_alternative_group(
        self, trip_id: str, group_id: str, payload: schemas.AlternativeGroupUpdate
    ) -> dict[str, Any]:
        """Rename a group (label null clears it) or add and remove members by record id. Removing a member only takes it out of the group; the record itself is untouched."""
        return self._call(
            "alternative_group.update",
            "alternative_group",
            group_id,
            trip_id,
            lambda s, sub: alternative_service.update_alternative_group(s, sub, trip_id, group_id, payload),
            lambda x: _alternative_group(x, True),
        )

    def delete_alternative_group(self, trip_id: str, group_id: str, confirm: bool = False) -> dict[str, str]:
        """Dissolve an alternative group after explicit confirmation. The records and their statuses are untouched."""
        return self._call(
            "alternative_group.delete",
            "alternative_group",
            group_id,
            trip_id,
            lambda s, sub: alternative_service.delete_alternative_group(s, sub, trip_id, group_id),
            lambda _: {"status": "deleted"},
            confirm=confirm,
            needs_confirmation=True,
        )

    def choose_alternative(
        self, trip_id: str, group_id: str, payload: schemas.AlternativeChoose, confirm: bool = False
    ) -> dict[str, Any]:
        """Choose this one (kies deze): in one transaction the chosen member (member_id, a stay, visit or route id of the group) becomes planned, or keeps planned or confirmed, and every other member is cancelled and made private (others=cancel, undoable with undo_alternative_choice) or deleted for good (others=remove, not undoable). Review get_alternative_group with the owner first. The result names the cancelled and removed ids and the audit event_id."""
        return self._call(
            "alternative_group.choose",
            "alternative_group",
            group_id,
            trip_id,
            lambda s, sub: alternative_service.choose_alternative(s, sub, trip_id, group_id, payload),
            lambda x: _model(x, schemas.AlternativeChoiceResponse),
            confirm=confirm,
            needs_confirmation=True,
        )

    def undo_alternative_choice(
        self, trip_id: str, group_id: str, event_id: schemas.Identifier | None = None, confirm: bool = False
    ) -> dict[str, Any]:
        """Undo the group's latest choice: the members get back the status and visibility they had, and the earlier chosen member is chosen again. Refused when the choice removed records, when a newer choice replaced it (event_id, if given, must be the latest) or when a member was edited after the choice."""
        return self._call(
            "alternative_group.undo_choice",
            "alternative_group",
            group_id,
            trip_id,
            lambda s, sub: alternative_service.undo_alternative_choice(s, sub, trip_id, group_id, event_id),
            lambda x: _alternative_group(x, True),
            confirm=confirm,
            needs_confirmation=True,
        )
