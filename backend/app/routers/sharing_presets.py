"""Owner-only, read-only review of a sharing preset for one audience (#241, step 1).

The review plans the preset and compares what the audience receives before and after, in a transaction that is
rolled back: it stores nothing, claims no revision and records no audit event. It is shared by the REST routes and
the MCP tools, and never reachable through a visitor response."""

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import current_subject
from ..database import get_session
from ..errors import ApiException
from ..models import Collection, CollectionMember, LinkState, PublicSurface, ShareLink, SurfaceState
from ..schemas import (
    Identifier,
    SharingPresetCatalog,
    SharingPresetDefinition,
    SharingPresetKindRule,
    SharingPresetRequest,
    SharingPresetReview,
)
from ..sharing_presets import (
    PRESET_DATE_PRECISION,
    PRESET_SCHEMA_VERSION,
    PresetAudience,
    preset_catalog,
    review_preset,
)
from .trips import owned_trip

router = APIRouter(tags=["publication"])

SessionDep = Annotated[Session, Depends(get_session)]
SubjectDep = Annotated[str, Depends(current_subject)]

# What a public view that was never saved holds once it is created: dates by month.
UNSAVED_PUBLIC_SCOPE = {"defaults": {"date_precision": "month"}}


def _not_found(detail: str) -> ApiException:
    return ApiException(status_code=status.HTTP_404_NOT_FOUND, detail=detail, code="not_found")


def _expired(expires_at: datetime | None) -> bool:
    if expires_at is None:
        return False
    return (expires_at if expires_at.tzinfo is not None else expires_at.replace(tzinfo=UTC)) <= datetime.now(UTC)


def _not_editable(what: str) -> ApiException:
    return ApiException(
        status_code=status.HTTP_409_CONFLICT,
        detail=f"A revoked or expired {what} cannot be edited",
        code=f"a_revoked_or_expired_{what}_cannot_be_edited",
    )


def preset_catalog_response(trip_id: Identifier, session: Session, subject: str) -> SharingPresetCatalog:
    owned_trip(session, trip_id, subject, load_relations=False)
    return SharingPresetCatalog(
        schema_version=PRESET_SCHEMA_VERSION,
        presets=[
            SharingPresetDefinition(
                id=preset.id,
                extends=preset.extends,
                selects=[
                    SharingPresetKindRule(kind=rule.kind, statuses=sorted(rule.statuses) if rule.statuses else None)
                    for rule in preset.selects
                ],
                photos="attached_to_included_updates",
                date_precision=PRESET_DATE_PRECISION,
            )
            for preset in preset_catalog()
        ],
    )


def review_sharing_preset(
    trip_id: Identifier, audience_id: str, payload: SharingPresetRequest, session: Session, subject: str
) -> SharingPresetReview:
    """Review a preset for ``public``, ``link:<id>`` or ``collection:<member id>`` of one of the owner's trips.

    A draft link or collection and an unpublished page are reviewed too (they deliver nothing yet); a revoked or
    expired one cannot be edited, so it has nothing to review. Reads only: this never creates the public view."""
    trip = owned_trip(session, trip_id, subject)
    kind, _, identifier = audience_id.partition(":")
    if audience_id == "public":
        surface = session.get(PublicSurface, trip_id)
        audience = PresetAudience(
            id="public",
            kind="public",
            label=None,
            scope=surface.scope if surface is not None else UNSAVED_PUBLIC_SCOPE,
            live=surface is not None and surface.state == SurfaceState.PUBLISHED,
            can_exclude=False,
        )
    elif kind == "link" and identifier:
        link = session.scalar(select(ShareLink).where(ShareLink.id == identifier, ShareLink.trip_id == trip_id))
        if link is None:
            raise _not_found("Share link not found")
        if link.state not in (LinkState.DRAFT, LinkState.ACTIVE) or (
            link.state == LinkState.ACTIVE and _expired(link.expires_at)
        ):
            raise _not_editable("link")
        audience = PresetAudience(
            id=f"link:{link.id}",
            kind="link",
            label=link.label,
            scope=link.scope,
            live=link.state == LinkState.ACTIVE,
            can_exclude=True,
        )
    elif kind == "collection" and identifier:
        found = session.execute(
            select(CollectionMember, Collection)
            .join(Collection, Collection.id == CollectionMember.collection_id)
            .where(
                CollectionMember.id == identifier,
                CollectionMember.trip_id == trip_id,
                Collection.owner_subject == subject,
            )
        ).first()
        if found is None:
            raise _not_found("Member not found")
        member, collection = found
        if collection.state not in (LinkState.DRAFT, LinkState.ACTIVE) or (
            collection.state == LinkState.ACTIVE and _expired(collection.expires_at)
        ):
            raise _not_editable("collection")
        audience = PresetAudience(
            id=f"collection:{member.id}",
            kind="collection_member",
            label=collection.label,
            scope=member.scope,
            live=collection.state == LinkState.ACTIVE,
            can_exclude=True,
        )
    else:
        raise _not_found("Audience not found")
    return review_preset(session, trip, audience, payload.preset)


@router.get("/trips/{trip_id}/sharing-presets", response_model=SharingPresetCatalog)
def list_sharing_presets(trip_id: Identifier, session: SessionDep, subject: SubjectDep) -> SharingPresetCatalog:
    return preset_catalog_response(trip_id, session, subject)


@router.post("/trips/{trip_id}/public-projection/preset/review", response_model=SharingPresetReview)
def review_public_preset(
    trip_id: Identifier, payload: SharingPresetRequest, session: SessionDep, subject: SubjectDep
) -> SharingPresetReview:
    return review_sharing_preset(trip_id, "public", payload, session, subject)


@router.post("/trips/{trip_id}/share-links/{link_id}/preset/review", response_model=SharingPresetReview)
def review_link_preset(
    trip_id: Identifier, link_id: Identifier, payload: SharingPresetRequest, session: SessionDep, subject: SubjectDep
) -> SharingPresetReview:
    return review_sharing_preset(trip_id, f"link:{link_id}", payload, session, subject)


@router.post("/collections/{collection_id}/members/{member_id}/preset/review", response_model=SharingPresetReview)
def review_collection_member_preset(
    collection_id: Identifier,
    member_id: Identifier,
    payload: SharingPresetRequest,
    session: SessionDep,
    subject: SubjectDep,
) -> SharingPresetReview:
    member = session.scalar(
        select(CollectionMember)
        .join(Collection, Collection.id == CollectionMember.collection_id)
        .where(
            CollectionMember.id == member_id,
            CollectionMember.collection_id == collection_id,
            Collection.owner_subject == subject,
        )
    )
    if member is None:
        raise _not_found("Member not found")
    return review_sharing_preset(member.trip_id, f"collection:{member.id}", payload, session, subject)
