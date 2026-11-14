"""Publication, named share links, sharing presets, previews and the audit of audiences."""

from __future__ import annotations

from typing import Any, Literal

from .. import schemas
from ..services import precision as precision_service
from ..services import publication as publication_service
from ..services import sharing_presets as preset_service
from .core import McpTools, storage
from .rendering import _model, _models, _share_url


def _preset_applied(value: Any) -> dict[str, Any]:
    """An applied preset's result from the REST representation; a link is shown without its capability token."""
    data = value.model_dump(mode="json")
    if isinstance(value, schemas.LinkPresetApplyResult):
        data["audience"] = schemas.McpShareLinkResponse.model_validate(value.audience.model_dump()).model_dump(
            mode="json"
        )
    return data


class SharingTools(McpTools):
    """Publication, named share links, sharing presets, previews and the audit of audiences."""

    def follow_audience_date_precision(
        self,
        trip_id: schemas.Identifier,
        kinds: list[Literal["visit", "stay"]] | None = None,
        confirm: bool = False,
        confirm_widening: bool = False,
    ) -> dict[str, Any]:
        """Let visits and stays follow each audience's date precision: set share_date_precision to null on every visit and/or stay (kinds, both by default) that has its own value, so the trip's audiences decide how precisely dates read (an audience sets defaults.date_precision in its share scope; with none it reads by month; the coarser of record and audience always wins). Use it instead of editing dozens of records one by one. Without confirm=true it only previews: changed counts the records that would follow the audience, and audiences lists each live audience (public, link:<id> or collection:<id>) whose view changes, with the visits and stays that would read finer (widened) or coarser (narrowed). When a live audience would read finer dates, confirm=true alone is refused with a JSON review (code precision_widening_needs_acknowledgement). Show it to the owner; repeat with confirm=true and confirm_widening=true only after they accept. The change is recorded in the audit trail with audience ids and counts."""
        payload = schemas.FollowAudiencePrecisionRequest(
            kinds=kinds or ["visit", "stay"], confirm=confirm, confirm_widening=confirm_widening
        )
        return self._call(
            "date_precision.follow_audience" if confirm else "date_precision.follow_audience_preview",
            "trip",
            trip_id,
            trip_id,
            lambda s, sub: precision_service.follow_audience_precision(s, sub, trip_id, payload),
            lambda x: _model(x, schemas.FollowAudiencePrecisionResult),
        )

    def get_public_projection_status(self, trip_id: schemas.Identifier) -> dict[str, Any]:
        """Read the public-surface state and current explicit scope."""
        return self._call(
            "public_projection.get",
            "public_surface",
            trip_id,
            trip_id,
            lambda s, sub: publication_service.get_public_projection_status(s, sub, trip_id),
            lambda x: _model(x, schemas.PublicProjectionStatusResponse),
        )

    def preview_public_projection(self, trip_id: schemas.Identifier) -> dict[str, Any]:
        """Preview what publishing the trip publicly would show: render the live public projection for owner review without publishing it."""
        return self._call(
            "public_projection.preview",
            "public_surface",
            trip_id,
            trip_id,
            lambda s, sub: publication_service.preview_public_projection(s, sub, trip_id),
            lambda x: _model(x, schemas.ProjectionDocument),
        )

    def set_public_projection_scope(
        self, trip_id: schemas.Identifier, payload: schemas.ShareScopeInput, confirm: bool = False
    ) -> dict[str, Any]:
        """Replace the live public scope after explicit owner confirmation. The scope may set defaults.date_precision (day, month or year): the finest date this audience may read, capping every record's own share_date_precision (the coarser wins; a record with none follows it). Leave defaults out to keep the audience's current setting; send defaults: null to remove the cap. The public view is the baseline every hidden link starts from, so scope.exclude is refused here (422 scope_exclusion_not_allowed); exclude records on a hidden link instead."""
        return self._call(
            "public_projection.scope",
            "public_surface",
            trip_id,
            trip_id,
            lambda s, sub: publication_service.set_public_projection_scope(s, sub, trip_id, payload),
            lambda x: _model(x, schemas.PublicProjectionStatusResponse),
            confirm=confirm,
            needs_confirmation=True,
        )

    def publish_public_projection(self, trip_id: schemas.Identifier, confirm: bool = False) -> dict[str, Any]:
        """Publish the trip publicly: start public delivery only after an explicit confirmation."""
        return self._call(
            "public_projection.publish",
            "public_surface",
            trip_id,
            trip_id,
            lambda s, sub: publication_service.publish_public_projection(s, sub, trip_id),
            lambda x: _model(x, schemas.PublicProjectionStatusResponse),
            confirm=confirm,
            needs_confirmation=True,
        )

    def unpublish_public_projection(
        self, trip_id: schemas.Identifier, reason: str | None = None, confirm: bool = False
    ) -> dict[str, Any]:
        """Stop public delivery only after explicit confirmation."""
        return self._call(
            "public_projection.unpublish",
            "public_surface",
            trip_id,
            trip_id,
            lambda s, sub: publication_service.unpublish_public_projection(
                s, sub, trip_id, schemas.AuditReasonInput(reason=reason)
            ),
            lambda x: _model(x, schemas.PublicProjectionStatusResponse),
            confirm=confirm,
            needs_confirmation=True,
        )

    # MCP exposure rule: ordinary link responses use McpShareLinkResponse, never
    # the owner REST ShareLinkResponse. Only activate/rotate return capabilities.
    def list_share_links(self, trip_id: schemas.Identifier) -> list[dict[str, Any]]:
        """List named share links without returning any capability token."""
        return self._call(
            "share_link.list",
            "share_link",
            None,
            trip_id,
            lambda s, sub: publication_service.list_share_links(s, sub, trip_id),
            lambda x: _models(x, schemas.McpShareLinkResponse),
        )

    def create_share_link(
        self, trip_id: schemas.Identifier, payload: schemas.ShareLinkCreate, confirm: bool = False
    ) -> dict[str, Any]:
        """Create a draft named share link after reviewing its audience scope. Unless the scope sets defaults.date_precision (day, month or year; the finest date this link may read, coarser wins over each record's own share_date_precision) the new link reads dates by month; send defaults: null for no cap. scope.exclude lists records set to everyone that this link must not receive, with whatever depends on them (see update_share_link)."""
        return self._call(
            "share_link.create",
            "share_link",
            None,
            trip_id,
            lambda s, sub: publication_service.create_share_link(s, sub, trip_id, payload),
            lambda x: _model(x, schemas.McpShareLinkResponse),
            confirm=confirm,
            needs_confirmation=True,
        )

    def get_share_link(self, trip_id: schemas.Identifier, link_id: schemas.Identifier) -> dict[str, Any]:
        """Read one named link's state and scoped audience without a capability token."""
        return self._call(
            "share_link.get",
            "share_link",
            link_id,
            trip_id,
            lambda s, sub: publication_service.get_share_link(s, sub, trip_id, link_id),
            lambda x: _model(x, schemas.McpShareLinkResponse),
        )

    def update_share_link(
        self,
        trip_id: schemas.Identifier,
        link_id: schemas.Identifier,
        payload: schemas.ShareLinkUpdate,
        confirm: bool = False,
    ) -> dict[str, Any]:
        """Update a named link's label or live scope after explicit owner confirmation. Leaving scope.defaults out keeps the link's current date precision; set defaults.date_precision or send defaults: null to change or remove it. scope.exclude lists records set to everyone that this link must not receive (see that field); leaving it out keeps them. Removing exclusions from an active link shows its visitors more, so it needs payload.confirm_widening=true (else 409 exclusion_widening_needs_acknowledgement lists the records)."""
        return self._call(
            "share_link.update",
            "share_link",
            link_id,
            trip_id,
            lambda s, sub: publication_service.update_share_link(s, sub, trip_id, link_id, payload),
            lambda x: _model(x, schemas.McpShareLinkResponse),
            confirm=confirm,
            needs_confirmation=True,
        )

    def preview_share_link(self, trip_id: schemas.Identifier, link_id: schemas.Identifier) -> dict[str, Any]:
        """Render a named link's current projection for owner review; no token is minted."""
        return self._call(
            "share_link.preview",
            "share_link",
            link_id,
            trip_id,
            lambda s, sub: publication_service.preview_share_link(s, sub, trip_id, link_id),
            lambda x: _model(x, schemas.ProjectionDocument),
        )

    def preview_public_projection_future_disclosure(
        self, trip_id: schemas.Identifier, scope: schemas.ShareScopeInput | None = None
    ) -> dict[str, Any]:
        """Review what the public view would show of a trip that has not started yet: transport (routes with a future departure) and day dates (records that would read by day). scope is the candidate selection to review (omit it for the saved one); it is counted from the same document the public preview renders. Returns transport and day_dates counts only. Stores nothing."""
        return self._call(
            "public_projection.future_disclosure",
            "public_surface",
            trip_id,
            trip_id,
            lambda s, sub: publication_service.review_public_future(s, sub, trip_id, scope),
            lambda x: _model(x, schemas.FutureDisclosure),
        )

    def preview_share_link_future_disclosure(
        self,
        trip_id: schemas.Identifier,
        link_id: schemas.Identifier,
        scope: schemas.ShareScopeInput | None = None,
    ) -> dict[str, Any]:
        """Review what a hidden link would show of a trip that has not started yet: transport (routes with a future departure) and day dates (records that would read by day). scope is the candidate selection to review (omit it for the saved one); it is counted from the same document the link's preview renders. Returns transport and day_dates counts only. Stores nothing."""
        return self._call(
            "share_link.future_disclosure",
            "share_link",
            link_id,
            trip_id,
            lambda s, sub: publication_service.review_link_future(s, sub, trip_id, link_id, scope),
            lambda x: _model(x, schemas.FutureDisclosure),
        )

    def preview_share_link_exclusions(
        self,
        trip_id: schemas.Identifier,
        exclude: list[schemas.ShareScopeItemInput] | None = None,
        items: list[schemas.ShareScopeItemInput] | None = None,
    ) -> dict[str, Any]:
        """Preview share link exclusions before saving: which records a hidden link or collection member would not receive. exclude lists records (kind + id) to leave out of the public baseline, items is the audience's custom selection. Returns baseline (everything that can be excluded), excluded (each exclusion with hides and also_hides: the dependent records it hides too, since excluding an area or location hides what uses it and excluding an update hides its photos), also_hidden and stale. Stores nothing."""
        payload = schemas.ExclusionReviewRequest(exclude=exclude or [], items=items or [])
        return self._call(
            "share_scope.exclusion_review",
            "trip",
            trip_id,
            trip_id,
            lambda s, sub: publication_service.review_exclusions(s, sub, trip_id, payload),
            lambda x: _model(x, schemas.ExclusionReview),
        )

    def list_sharing_presets(self, trip_id: schemas.Identifier) -> dict[str, Any]:
        """List the sharing presets (story_only, story_and_route, planned_trip): named starting points for what one audience receives. Each selects kinds of records (updates; then also areas and routes; then also visits and stays), only planned or confirmed plans, never locations, addresses, times or documents, and sets the audience's dates to at most month precision. A preset never makes a record visible to everyone."""
        return self._call(
            "sharing_preset.list",
            "trip",
            trip_id,
            trip_id,
            lambda s, sub: preset_service.preset_catalog_response(s, sub, trip_id),
            lambda x: _model(x, schemas.SharingPresetCatalog),
        )

    def preview_sharing_preset(
        self, trip_id: schemas.Identifier, preset: schemas.SharingPresetId, audience: str = "public"
    ) -> dict[str, Any]:
        """Review a sharing preset for one audience before anything is applied (apply_sharing_preset applies it). audience is `public`, `link:<link id>` or `collection:<collection member id>`. Returns the changes the preset would make (records listed for or unlisted from this audience, records left out of a hidden link, private records that become custom for this audience only), how many records of each kind the audience receives now and afterwards, which records it would newly receive (widened, and requires_acknowledgement when the audience is live) or stop receiving, the date precision before and after, the records it keeps receiving that the preset does not include with the way out (left_as_is), the records a preset did not sweep in and why (needs_decision), and the owner's choices it would reset (replaces_exceptions). A plan beyond the scope limits is refused with refusal.code preset_too_large. Show the owner the review, and pass its fingerprint to apply_sharing_preset only after they accept. Stores nothing, claims no revision and records no audit event."""
        return self._call(
            "sharing_preset.preview",
            "trip",
            trip_id,
            trip_id,
            lambda s, sub: preset_service.review_sharing_preset(
                s, sub, trip_id, audience, schemas.SharingPresetRequest(preset=preset)
            ),
            lambda x: _model(x, schemas.SharingPresetReview),
        )

    def apply_sharing_preset(
        self,
        trip_id: schemas.Identifier,
        preset: schemas.SharingPresetId,
        fingerprint: str,
        audience: str = "public",
        confirm: bool = False,
        confirm_widening: bool = False,
    ) -> dict[str, Any]:
        """Apply a sharing preset to one audience (`public`, `link:<link id>` or `collection:<collection member id>`) after the owner accepted the preview_sharing_preset review; fingerprint is that review's fingerprint. In one transaction it makes the preset's private records custom and lists them for this audience only (a preset never writes everyone, so no other audience changes), unlists or leaves out the records the preset does not include (a hidden link or collection member; the public view cannot leave records out), caps the audience's dates at month at most, and resets the owner's earlier exceptions. Without confirm=true nothing is stored. If the records or the audience changed since the preview, it is refused (code preset_preview_is_stale, with a fresh review): show that review again. A plan beyond the scope limits is refused (code preset_too_large). When a live audience (published public view, active link or collection) would newly receive records, confirm=true alone is refused with a JSON review (code preset_widening_needs_acknowledgement; counts and widened records): show it to the owner and repeat with confirm=true and confirm_widening=true only after they accept; a draft audience needs no acknowledgement. Returns applied (false when the audience already matched: nothing written), the review that was applied and the audience with its applied_preset label and preset_exceptions (the live difference from the preset). The apply is recorded in the audit trail with the preset id, the audience id and counts only."""
        payload = schemas.SharingPresetApplyRequest(
            preset=preset, fingerprint=fingerprint, confirm_widening=confirm_widening
        )
        return self._call(
            "sharing_preset.apply",
            "trip",
            trip_id,
            trip_id,
            lambda s, sub: preset_service.apply_sharing_preset(s, sub, trip_id, audience, payload),
            _preset_applied,
            confirm=confirm,
            needs_confirmation=True,
        )

    def activate_share_link(
        self,
        trip_id: schemas.Identifier,
        link_id: schemas.Identifier,
        payload: schemas.ShareLinkActivateRequest,
        confirm: bool = False,
    ) -> dict[str, Any]:
        """Activate a reusable owner-managed URL and return its full visitor URL."""
        return self._call(
            "share_link.activate",
            "share_link",
            link_id,
            trip_id,
            lambda s, sub: publication_service.activate_share_link(s, sub, trip_id, link_id, payload),
            lambda x: {**_model(x, schemas.ShareLinkActivateResponse), "share_url": _share_url(x.token)},
            confirm=confirm,
            needs_confirmation=True,
        )

    def revoke_share_link(
        self, trip_id: schemas.Identifier, link_id: schemas.Identifier, reason: str | None = None, confirm: bool = False
    ) -> dict[str, Any]:
        """Immediately revoke a share capability after explicit confirmation."""
        return self._call(
            "share_link.revoke",
            "share_link",
            link_id,
            trip_id,
            lambda s, sub: publication_service.revoke_share_link(
                s, sub, trip_id, link_id, schemas.AuditReasonInput(reason=reason)
            ),
            lambda x: _model(x, schemas.McpShareLinkResponse),
            confirm=confirm,
            needs_confirmation=True,
        )

    def rotate_share_link(
        self,
        trip_id: schemas.Identifier,
        link_id: schemas.Identifier,
        payload: schemas.ShareLinkActivateRequest,
        confirm: bool = False,
    ) -> dict[str, Any]:
        """Revoke the current capability and return a new full visitor URL after confirmation."""
        return self._call(
            "share_link.rotate",
            "share_link",
            link_id,
            trip_id,
            lambda s, sub: publication_service.rotate_share_link(s, sub, trip_id, link_id, payload),
            lambda x: {**_model(x, schemas.ShareLinkActivateResponse), "share_url": _share_url(x.token)},
            confirm=confirm,
            needs_confirmation=True,
        )

    def list_trip_audit_events(self, trip_id: schemas.Identifier) -> list[dict[str, Any]]:
        """Read audience/publication lifecycle history for an owned trip."""
        return self._call(
            "audit_event.list",
            "audit_event",
            None,
            trip_id,
            lambda s, sub: publication_service.list_audit_events(s, sub, trip_id),
            lambda x: _models(x, schemas.AuditEventResponse),
        )

    def preview_public_navigation(self, trip_id: schemas.Identifier, local_id: schemas.SafeText) -> dict[str, Any]:
        """Verify an opaque public-preview navigation marker and return its destination."""
        return self._call(
            "public_projection.preview_navigation",
            "public_surface",
            local_id,
            trip_id,
            lambda s, sub: publication_service.public_preview_navigation(s, sub, trip_id, local_id),
            lambda url: {"url": url},
        )

    def preview_share_navigation(
        self, trip_id: schemas.Identifier, link_id: schemas.Identifier, local_id: schemas.SafeText
    ) -> dict[str, Any]:
        """Verify an opaque named-link preview navigation marker and return its destination."""
        return self._call(
            "share_link.preview_navigation",
            "share_link",
            link_id,
            trip_id,
            lambda s, sub: publication_service.share_preview_navigation(s, sub, trip_id, link_id, local_id),
            lambda url: {"url": url},
        )

    def inspect_public_preview_file(
        self, trip_id: schemas.Identifier, local_id: schemas.SafeText
    ) -> dict[str, str | None]:
        """Verify that a scoped public-preview file is deliverable without returning its bytes."""
        return self._call(
            "public_projection.preview_file",
            "public_surface",
            local_id,
            trip_id,
            lambda s, sub: publication_service.inspect_public_preview_file(s, sub, trip_id, local_id, storage()),
        )

    def inspect_share_preview_file(
        self, trip_id: schemas.Identifier, link_id: schemas.Identifier, local_id: schemas.SafeText
    ) -> dict[str, str | None]:
        """Verify that a scoped named-link preview file is deliverable without returning its bytes."""
        return self._call(
            "share_link.preview_file",
            "share_link",
            link_id,
            trip_id,
            lambda s, sub: publication_service.inspect_share_preview_file(
                s, sub, trip_id, link_id, local_id, storage()
            ),
        )
