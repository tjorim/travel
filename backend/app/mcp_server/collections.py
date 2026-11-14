"""Collection links: one capability that opens several trips."""

from __future__ import annotations

from typing import Any

from .. import schemas
from ..services import collections as collection_service
from .core import McpTools
from .rendering import _model, _share_url


def _mcp_collection(value: Any) -> dict[str, Any]:
    """A collection without its capability token, from the REST representation."""
    return schemas.McpCollectionResponse.model_validate(value.model_dump()).model_dump(mode="json")


def _collection_with_url(value: Any) -> dict[str, Any]:
    return {**_mcp_collection(value), "share_url": _share_url(value.token)}


class CollectionTools(McpTools):
    """Collection links: one capability that opens several trips."""

    # Collection links: one capability that opens several trips. Ordinary responses
    # never carry the token; only activate/rotate return the full visitor URL.
    def list_collections(self) -> list[dict[str, Any]]:
        """List the owner's collection links and their members without any capability token."""
        return self._call(
            "collection.list",
            "collection",
            None,
            None,
            lambda s, sub: collection_service.list_collections(s, sub),
            lambda x: [_mcp_collection(item) for item in x],
        )

    def create_collection(self, payload: schemas.CollectionCreate, confirm: bool = False) -> dict[str, Any]:
        """Create a draft collection link; add member trips with their own scopes before activating it."""
        return self._call(
            "collection.create",
            "collection",
            None,
            None,
            lambda s, sub: collection_service.create_collection(s, sub, payload),
            _mcp_collection,
            confirm=confirm,
            needs_confirmation=True,
        )

    def get_collection(self, collection_id: schemas.Identifier) -> dict[str, Any]:
        """Read one collection's state and members without a capability token."""
        return self._call(
            "collection.get",
            "collection",
            collection_id,
            None,
            lambda s, sub: collection_service.get_collection(s, sub, collection_id),
            _mcp_collection,
        )

    def update_collection(
        self, collection_id: schemas.Identifier, payload: schemas.CollectionUpdate, confirm: bool = False
    ) -> dict[str, Any]:
        """Rename a collection or change the title visitors see, after explicit owner confirmation."""
        return self._call(
            "collection.update",
            "collection",
            collection_id,
            None,
            lambda s, sub: collection_service.update_collection(s, sub, collection_id, payload),
            _mcp_collection,
            confirm=confirm,
            needs_confirmation=True,
        )

    def add_collection_member(
        self, collection_id: schemas.Identifier, payload: schemas.CollectionMemberCreate, confirm: bool = False
    ) -> dict[str, Any]:
        """Add an owned trip to a collection at its own scope, after explicit owner confirmation."""
        return self._call(
            "collection.member_add",
            "collection",
            collection_id,
            payload.trip_id,
            lambda s, sub: collection_service.add_collection_member(s, sub, collection_id, payload),
            _mcp_collection,
            confirm=confirm,
            needs_confirmation=True,
        )

    def update_collection_member(
        self,
        collection_id: schemas.Identifier,
        member_id: schemas.Identifier,
        scope: schemas.ShareScopeInput,
        confirm: bool = False,
        confirm_widening: bool = False,
    ) -> dict[str, Any]:
        """Change what one member trip delivers; takes effect immediately on an active collection. scope.exclude leaves records set to everyone out of this member (see that field); removing exclusions from an active collection needs confirm_widening=true (else 409 exclusion_widening_needs_acknowledgement lists the records)."""
        return self._call(
            "collection.member_scope",
            "collection",
            collection_id,
            None,
            lambda s, sub: collection_service.set_collection_member_scope(
                s, sub, collection_id, member_id, scope, confirm_widening=confirm_widening
            ),
            _mcp_collection,
            confirm=confirm,
            needs_confirmation=True,
        )

    def remove_collection_member(
        self, collection_id: schemas.Identifier, member_id: schemas.Identifier, confirm: bool = False
    ) -> dict[str, Any]:
        """Remove a trip from a collection; its page there stops working at once."""
        return self._call(
            "collection.member_remove",
            "collection",
            collection_id,
            None,
            lambda s, sub: collection_service.remove_collection_member(s, sub, collection_id, member_id),
            _mcp_collection,
            confirm=confirm,
            needs_confirmation=True,
        )

    def preview_collection_member(
        self, collection_id: schemas.Identifier, member_id: schemas.Identifier
    ) -> dict[str, Any]:
        """Render one member trip as the collection's visitors would see it; no token is minted."""
        return self._call(
            "collection.preview",
            "collection",
            collection_id,
            None,
            lambda s, sub: collection_service.preview_collection_member(s, sub, collection_id, member_id),
            lambda x: _model(x, schemas.ProjectionDocument),
        )

    def preview_collection_member_future_disclosure(
        self,
        collection_id: schemas.Identifier,
        member_id: schemas.Identifier,
        scope: schemas.ShareScopeInput | None = None,
    ) -> dict[str, Any]:
        """Review what a collection member would show of a trip that has not started yet: transport (routes with a future departure) and day dates (records that would read by day). scope is the candidate selection to review (omit it for the saved one); it is counted from the same document the member's preview renders. Returns transport and day_dates counts only. Stores nothing."""
        return self._call(
            "collection.future_disclosure",
            "collection",
            collection_id,
            None,
            lambda s, sub: collection_service.review_member_future(s, sub, collection_id, member_id, scope),
            lambda x: _model(x, schemas.FutureDisclosure),
        )

    def activate_collection(
        self, collection_id: schemas.Identifier, payload: schemas.ShareLinkActivateRequest, confirm: bool = False
    ) -> dict[str, Any]:
        """Activate a draft collection and return its full visitor URL."""
        return self._call(
            "collection.activate",
            "collection",
            collection_id,
            None,
            lambda s, sub: collection_service.activate_collection(s, sub, collection_id, payload),
            _collection_with_url,
            confirm=confirm,
            needs_confirmation=True,
        )

    def revoke_collection(
        self, collection_id: schemas.Identifier, reason: str | None = None, confirm: bool = False
    ) -> dict[str, Any]:
        """Immediately revoke a collection capability after explicit confirmation."""
        return self._call(
            "collection.revoke",
            "collection",
            collection_id,
            None,
            lambda s, sub: collection_service.revoke_collection(
                s, sub, collection_id, schemas.AuditReasonInput(reason=reason)
            ),
            _mcp_collection,
            confirm=confirm,
            needs_confirmation=True,
        )

    def rotate_collection(
        self, collection_id: schemas.Identifier, payload: schemas.ShareLinkActivateRequest, confirm: bool = False
    ) -> dict[str, Any]:
        """Replace a collection's capability and return the new full visitor URL after confirmation."""
        return self._call(
            "collection.rotate",
            "collection",
            collection_id,
            None,
            lambda s, sub: collection_service.rotate_collection(s, sub, collection_id, payload),
            _collection_with_url,
            confirm=confirm,
            needs_confirmation=True,
        )
