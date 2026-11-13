"""Packing lists, bags and items."""

from __future__ import annotations

from typing import Any

from .. import schemas
from ..services import packing as packing_service
from .core import McpTools
from .rendering import _model, _models


class PackingTools(McpTools):
    """Packing lists, bags and items."""

    def list_packing_lists(self, trip_id: str) -> list[dict[str, Any]]:
        """List the trip's private packing lists."""
        return self._call(
            "packing_list.list",
            "packing_list",
            None,
            trip_id,
            lambda s, sub: packing_service.list_packing_lists(s, sub, trip_id),
            lambda x: _models(x, schemas.PackingListResponse),
        )

    def create_packing_list(self, trip_id: str, payload: schemas.PackingListCreate) -> dict[str, Any]:
        """Create a private packing list for a trip."""
        return self._call(
            "packing_list.create",
            "packing_list",
            None,
            trip_id,
            lambda s, sub: packing_service.create_packing_list(s, sub, trip_id, payload),
            lambda x: _model(x, schemas.PackingListResponse),
        )

    def get_packing_list(self, trip_id: str, list_id: str) -> dict[str, Any]:
        """Read one private packing list."""
        return self._call(
            "packing_list.get",
            "packing_list",
            list_id,
            trip_id,
            lambda s, sub: packing_service.get_packing_list(s, sub, trip_id, list_id),
            lambda x: _model(x, schemas.PackingListResponse),
        )

    def update_packing_list(self, trip_id: str, list_id: str, payload: schemas.PackingListUpdate) -> dict[str, Any]:
        """Rename a private packing list."""
        return self._call(
            "packing_list.update",
            "packing_list",
            list_id,
            trip_id,
            lambda s, sub: packing_service.update_packing_list(s, sub, trip_id, list_id, payload),
            lambda x: _model(x, schemas.PackingListResponse),
        )

    def delete_packing_list(self, trip_id: str, list_id: str, confirm: bool = False) -> dict[str, str]:
        """Delete a list and all its bags and items after explicit confirmation."""
        return self._call(
            "packing_list.delete",
            "packing_list",
            list_id,
            trip_id,
            lambda s, sub: packing_service.delete_packing_list(s, sub, trip_id, list_id),
            lambda _: {"status": "deleted"},
            confirm=confirm,
            needs_confirmation=True,
        )

    def list_packing_bags(self, trip_id: str, list_id: str) -> list[dict[str, Any]]:
        """List a packing list's bags in display order."""
        return self._call(
            "packing_bag.list",
            "packing_bag",
            None,
            trip_id,
            lambda s, sub: packing_service.list_packing_bags(s, sub, trip_id, list_id),
            lambda x: _models(x, schemas.PackingBagResponse),
        )

    def get_packing_bag(self, trip_id: str, list_id: str, bag_id: str) -> dict[str, Any]:
        """Read one bag, including its optional weight limit in grams."""
        return self._call(
            "packing_bag.get",
            "packing_bag",
            bag_id,
            trip_id,
            lambda s, sub: packing_service.get_packing_bag(s, sub, trip_id, list_id, bag_id),
            lambda x: _model(x, schemas.PackingBagResponse),
        )

    def create_packing_bag(self, trip_id: str, list_id: str, payload: schemas.PackingBagCreate) -> dict[str, Any]:
        """Create and position a bag."""
        return self._call(
            "packing_bag.create",
            "packing_bag",
            None,
            trip_id,
            lambda s, sub: packing_service.create_packing_bag(s, sub, trip_id, list_id, payload),
            lambda x: _model(x, schemas.PackingBagResponse),
        )

    def update_packing_bag(
        self, trip_id: str, list_id: str, bag_id: str, payload: schemas.PackingBagUpdate
    ) -> dict[str, Any]:
        """Update or reorder a bag."""
        return self._call(
            "packing_bag.update",
            "packing_bag",
            bag_id,
            trip_id,
            lambda s, sub: packing_service.update_packing_bag(s, sub, trip_id, list_id, bag_id, payload),
            lambda x: _model(x, schemas.PackingBagResponse),
        )

    def delete_packing_bag(self, trip_id: str, list_id: str, bag_id: str, confirm: bool = False) -> dict[str, str]:
        """Delete a bag after confirmation; its items become unassigned."""
        return self._call(
            "packing_bag.delete",
            "packing_bag",
            bag_id,
            trip_id,
            lambda s, sub: packing_service.delete_packing_bag(s, sub, trip_id, list_id, bag_id),
            lambda _: {"status": "deleted"},
            confirm=confirm,
            needs_confirmation=True,
        )

    def list_packing_items(self, trip_id: str, list_id: str) -> list[dict[str, Any]]:
        """List all packed and unpacked items, including unassigned items."""
        return self._call(
            "packing_item.list",
            "packing_item",
            None,
            trip_id,
            lambda s, sub: packing_service.list_packing_items(s, sub, trip_id, list_id),
            lambda x: _models(x, schemas.PackingItemResponse),
        )

    def get_packing_item(self, trip_id: str, list_id: str, item_id: str) -> dict[str, Any]:
        """Read a packing item."""
        return self._call(
            "packing_item.get",
            "packing_item",
            item_id,
            trip_id,
            lambda s, sub: packing_service.get_packing_item(s, sub, trip_id, list_id, item_id),
            lambda x: _model(x, schemas.PackingItemResponse),
        )

    def create_packing_item(self, trip_id: str, list_id: str, payload: schemas.PackingItemCreate) -> dict[str, Any]:
        """Create one packing item, optionally assigned to a bag."""
        return self._call(
            "packing_item.create",
            "packing_item",
            None,
            trip_id,
            lambda s, sub: packing_service.create_packing_item(s, sub, trip_id, list_id, payload),
            lambda x: _model(x, schemas.PackingItemResponse),
        )

    def batch_create_packing_items(
        self, trip_id: str, list_id: str, payload: list[schemas.PackingItemCreate]
    ) -> list[dict[str, Any]]:
        """Create up to 100 packing items atomically."""
        return self._call(
            "packing_item.batch_create",
            "packing_item",
            None,
            trip_id,
            lambda s, sub: packing_service.batch_create_packing_items(s, sub, trip_id, list_id, payload),
            lambda x: _models(x, schemas.PackingItemResponse),
        )

    def update_packing_item(
        self, trip_id: str, list_id: str, item_id: str, payload: schemas.PackingItemUpdate
    ) -> dict[str, Any]:
        """Update packed state, bag assignment, order or item details."""
        return self._call(
            "packing_item.update",
            "packing_item",
            item_id,
            trip_id,
            lambda s, sub: packing_service.update_packing_item(s, sub, trip_id, list_id, item_id, payload),
            lambda x: _model(x, schemas.PackingItemResponse),
        )

    def mark_packing_item(self, trip_id: str, list_id: str, item_id: str, packed: bool) -> dict[str, Any]:
        """Mark one item packed or unpacked."""
        return self._call(
            "packing_item.mark",
            "packing_item",
            item_id,
            trip_id,
            lambda s, sub: packing_service.update_packing_item(
                s, sub, trip_id, list_id, item_id, schemas.PackingItemUpdate(packed=packed)
            ),
            lambda x: _model(x, schemas.PackingItemResponse),
        )

    def move_packing_item(
        self, trip_id: str, list_id: str, item_id: str, bag_id: str | None, position: int
    ) -> dict[str, Any]:
        """Move an item to a bag or Unassigned at a zero-based position."""
        return self._call(
            "packing_item.move",
            "packing_item",
            item_id,
            trip_id,
            lambda s, sub: packing_service.update_packing_item(
                s, sub, trip_id, list_id, item_id, schemas.PackingItemUpdate(bag_id=bag_id, position=position)
            ),
            lambda x: _model(x, schemas.PackingItemResponse),
        )

    def delete_packing_item(self, trip_id: str, list_id: str, item_id: str, confirm: bool = False) -> dict[str, str]:
        """Delete an item after explicit confirmation."""
        return self._call(
            "packing_item.delete",
            "packing_item",
            item_id,
            trip_id,
            lambda s, sub: packing_service.delete_packing_item(s, sub, trip_id, list_id, item_id),
            lambda _: {"status": "deleted"},
            confirm=confirm,
            needs_confirmation=True,
        )
