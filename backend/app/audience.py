"""One audience, whichever table stores it (#360, decision 360).

An **audience** is something that receives a trip through a scope: the **public view** (``PublicSurface``), a
**hidden link** (``ShareLink``) or a **collection member** (``CollectionMember``). The three stay three tables with
their own routes and payloads; this module is the one interface the code above them takes, so a preview, a preset
review, an exclusion check, a scope edit or a live-location setting is written once and runs for each kind.

Nothing here commits, validates a scope or knows an HTTP request: it exposes what an audience *is* (its scope,
revision, applied preset label, whether it delivers today, where its history is written, whether live location
may name it). The operations that use it are in ``app.services.audiences``.
"""

from abc import ABC, abstractmethod
from copy import deepcopy
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import ClassVar, cast

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import InstrumentedAttribute

from .models import (
    AuditEventKind,
    AuditTargetType,
    Collection,
    CollectionAuditKind,
    CollectionMember,
    LinkState,
    PublicSurface,
    ShareLink,
    SurfaceState,
)

# The key of the public view in a preset, an audit entry, a live-location setting and a PDF request; a hidden link
# is ``link:<id>`` and a collection member ``collection:<member id>`` there (live location names a link by its id).
PUBLIC_KEY = "public"
PUBLIC_SCHEMA = "travel/public-trip@1"
UNLISTED_SCHEMA = "travel/unlisted-trip@1"

# The rows that hold an audience.
StoredAudience = PublicSurface | ShareLink | CollectionMember
StoredModel = type[PublicSurface] | type[ShareLink] | type[CollectionMember]

# The states of a hidden link or a collection that can still be edited, and that deliver or will once activated.
OPEN_STATES = (LinkState.DRAFT, LinkState.ACTIVE)


def default_public_scope() -> dict:
    """What a public view holds until the owner chooses otherwise: dates by month, nothing listed."""
    return deepcopy({"defaults": {"date_precision": "month"}})


def aware_utc(value: datetime) -> datetime:
    # SQLite (used in tests) drops tzinfo on round-trip even for a
    # DateTime(timezone=True) column; Postgres (production) preserves it.
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def has_expired(expires_at: datetime | None) -> bool:
    """Whether a capability with this ``expires_at`` is past it (a capability without one never expires)."""
    return expires_at is not None and aware_utc(expires_at) <= datetime.now(UTC)


class AudienceKind(StrEnum):
    PUBLIC = "public"
    LINK = "link"
    COLLECTION_MEMBER = "collection_member"


@dataclass(frozen=True)
class AuditTarget:
    """Where the owner-visible history of an audience is written.

    A public view and a hidden link write to the trip's trail (``target_type`` and ``target_id``); a collection
    member writes to its collection's own trail (``collection_id``), naming the member in the details."""

    scope_change: AuditEventKind | CollectionAuditKind
    preset_apply: AuditEventKind | CollectionAuditKind
    target_id: str
    target_type: AuditTargetType | None = None
    collection_id: str | None = None


class Audience(ABC):
    """A stored public view, hidden link or collection member, seen through what every audience shares."""

    kind: ClassVar[AudienceKind]
    # Whether the scope may exclude records. The public view is the baseline every other audience subtracts from.
    can_exclude: ClassVar[bool]
    # The document schema a visitor of this audience receives.
    schema_version: ClassVar[str]
    # What the owner calls it in "A revoked or expired {noun} cannot be edited".
    noun: ClassVar[str]

    def __init__(self, holder: PublicSurface | ShareLink | CollectionMember) -> None:
        self.holder = holder

    # --- what is stored -------------------------------------------------------------------------------------

    @property
    def trip_id(self) -> str:
        return self.holder.trip_id

    @property
    def scope(self) -> dict:
        return self.holder.scope

    @scope.setter
    def scope(self, value: dict) -> None:
        self.holder.scope = value

    @property
    def stored_scope(self) -> dict | None:
        """The saved scope, or ``None`` for an audience that was never saved (only a public view can be)."""
        return self.scope

    @property
    def revision(self) -> int:
        return self.holder.revision

    @property
    def applied_preset(self) -> str | None:
        return self.holder.applied_preset

    @property
    def applied_preset_at(self) -> datetime | None:
        return self.holder.applied_preset_at

    def label_preset(self, preset_id: str) -> None:
        """Set the display label of the preset last applied (never read by delivery, see ``models``)."""
        self.holder.applied_preset = preset_id
        self.holder.applied_preset_at = datetime.now(UTC)

    # --- what it is ------------------------------------------------------------------------------------------

    @property
    @abstractmethod
    def record_id(self) -> str:
        """The id of the stored row (the trip's id for its public view)."""

    @property
    @abstractmethod
    def id(self) -> str:
        """The audience as a preset, a review, the audit trail and a delivered-to list name it: ``public``,
        ``link:<link id>`` or ``collection:<member id>``."""

    @property
    @abstractmethod
    def label(self) -> str | None:
        """The owner's own name for it (a link's or collection's label); the public view has none."""

    @property
    def display_name(self) -> str:
        """How an owner-only message names it: ``public page``, ``link 'Family'``, ``collection 'Friends'``."""
        return f"{self.noun} {self.label!r}"

    @property
    @abstractmethod
    def live(self) -> bool:
        """Whether it delivers right now (a published view, an active unexpired link or collection)."""

    @property
    @abstractmethod
    def editable(self) -> bool:
        """Whether the owner may still change it: a draft, or live. A revoked or expired one is gone."""

    @property
    @abstractmethod
    def live_location_key(self) -> str | None:
        """How a live-location setting names it (``public`` or the link's id), or ``None`` when live location
        cannot be shown to this audience (decision 244)."""

    @property
    @abstractmethod
    def audit_target(self) -> AuditTarget: ...

    # --- the revision claim --------------------------------------------------------------------------------

    @property
    @abstractmethod
    def revision_column(self) -> tuple[StoredModel, InstrumentedAttribute, str]:
        """The table, its key column and the key value an atomic revision claim updates."""


class PublicAudience(Audience):
    """The public view of a trip. ``None`` as the holder is a view the owner never saved: it reads as the default
    scope, delivers nothing and is created by the first write."""

    kind = AudienceKind.PUBLIC
    can_exclude = False
    schema_version = PUBLIC_SCHEMA
    noun = "public view"

    def __init__(self, holder: PublicSurface | None, trip_id: str | None = None) -> None:
        if holder is None and trip_id is None:
            raise ValueError("An unsaved public view needs its trip")
        super().__init__(cast(PublicSurface, holder))
        self._trip_id = trip_id

    @property
    def surface(self) -> PublicSurface | None:
        return cast(PublicSurface | None, self.holder)

    @property
    def row(self) -> PublicSurface:
        """The stored row of a public view that is saved."""
        assert self.surface is not None
        return self.surface

    @property
    def trip_id(self) -> str:
        return self.surface.trip_id if self.surface is not None else str(self._trip_id)

    @property
    def scope(self) -> dict:
        return self.surface.scope if self.surface is not None else default_public_scope()

    @scope.setter
    def scope(self, value: dict) -> None:
        assert self.surface is not None
        self.surface.scope = value

    @property
    def stored_scope(self) -> dict | None:
        return self.surface.scope if self.surface is not None else None

    @property
    def revision(self) -> int:
        return self.surface.revision if self.surface is not None else 0

    @property
    def applied_preset(self) -> str | None:
        return self.surface.applied_preset if self.surface is not None else None

    @property
    def applied_preset_at(self) -> datetime | None:
        return self.surface.applied_preset_at if self.surface is not None else None

    @property
    def record_id(self) -> str:
        return self.trip_id

    @property
    def id(self) -> str:
        return PUBLIC_KEY

    @property
    def label(self) -> str | None:
        return None

    @property
    def display_name(self) -> str:
        return "public page"

    @property
    def live(self) -> bool:
        return self.surface is not None and self.surface.state == SurfaceState.PUBLISHED

    @property
    def editable(self) -> bool:
        return True

    @property
    def live_location_key(self) -> str | None:
        return PUBLIC_KEY

    @property
    def audit_target(self) -> AuditTarget:
        return AuditTarget(
            scope_change=AuditEventKind.PUBLIC_PROJECTION_SCOPE_CHANGE,
            preset_apply=AuditEventKind.PUBLIC_PROJECTION_PRESET_APPLY,
            target_type=AuditTargetType.PUBLIC_SURFACE,
            target_id=self.trip_id,
        )

    @property
    def revision_column(self) -> tuple[StoredModel, InstrumentedAttribute, str]:
        return PublicSurface, PublicSurface.trip_id, self.trip_id


def capability_editable(capability: ShareLink | Collection) -> bool:
    """A draft or live link or collection can be edited; a revoked or expired one is gone."""
    return capability.state in OPEN_STATES and not (
        capability.state == LinkState.ACTIVE and has_expired(capability.expires_at)
    )


class _CapabilityAudience(Audience):
    """An audience reached through a capability of its own (a link) or of its collection (a member): it delivers
    while that capability is active and unexpired."""

    @property
    @abstractmethod
    def capability(self) -> ShareLink | Collection: ...

    @property
    def live(self) -> bool:
        return self.capability.state == LinkState.ACTIVE and not has_expired(self.capability.expires_at)

    @property
    def editable(self) -> bool:
        return capability_editable(self.capability)


class LinkAudience(_CapabilityAudience):
    kind = AudienceKind.LINK
    can_exclude = True
    schema_version = UNLISTED_SCHEMA
    noun = "link"

    @property
    def link(self) -> ShareLink:
        return cast(ShareLink, self.holder)

    @property
    def capability(self) -> ShareLink:
        return self.link

    @property
    def record_id(self) -> str:
        return self.link.id

    @property
    def id(self) -> str:
        return f"link:{self.link.id}"

    @property
    def label(self) -> str | None:
        return self.link.label

    @property
    def live_location_key(self) -> str | None:
        return self.link.id

    @property
    def audit_target(self) -> AuditTarget:
        return AuditTarget(
            scope_change=AuditEventKind.SHARE_LINK_SCOPE_CHANGE,
            preset_apply=AuditEventKind.SHARE_LINK_PRESET_APPLY,
            target_type=AuditTargetType.SHARE_LINK,
            target_id=self.link.id,
        )

    @property
    def revision_column(self) -> tuple[StoredModel, InstrumentedAttribute, str]:
        return ShareLink, ShareLink.id, self.link.id


class MemberAudience(_CapabilityAudience):
    kind = AudienceKind.COLLECTION_MEMBER
    can_exclude = True
    schema_version = UNLISTED_SCHEMA
    noun = "collection"

    def __init__(self, holder: CollectionMember, collection: Collection | None = None) -> None:
        super().__init__(holder)
        self._collection = collection

    @property
    def member(self) -> CollectionMember:
        return cast(CollectionMember, self.holder)

    @property
    def collection(self) -> Collection:
        return self._collection if self._collection is not None else self.member.collection

    @property
    def capability(self) -> Collection:
        return self.collection

    @property
    def record_id(self) -> str:
        return self.member.id

    @property
    def id(self) -> str:
        return f"collection:{self.member.id}"

    @property
    def label(self) -> str | None:
        return self.collection.label

    @property
    def live_location_key(self) -> str | None:
        # Decision 244: a live location names the public view or one hidden link, never a collection member.
        return None

    @property
    def audit_target(self) -> AuditTarget:
        return AuditTarget(
            scope_change=CollectionAuditKind.MEMBER_SCOPE_CHANGE,
            preset_apply=CollectionAuditKind.MEMBER_PRESET_APPLY,
            target_id=self.member.id,
            collection_id=self.member.collection_id,
        )

    @property
    def revision_column(self) -> tuple[StoredModel, InstrumentedAttribute, str]:
        return CollectionMember, CollectionMember.id, self.member.id


class Reach(StrEnum):
    """Which audiences of a trip to list."""

    STORED = "stored"  # every one saved, whatever its state
    OPEN = "open"  # those that deliver or will once activated: the public view, drafts and live ones
    DELIVERING = "delivering"  # those that deliver today by state: a published view, active links and collections


def audiences_of_trip(session: Session, trip_id: str, reach: Reach) -> list[Audience]:
    """The audiences of a trip in a stable order: the public view, its links, then its collection members.

    ``Reach.DELIVERING`` is by state only: an active link past its ``expires_at`` that nobody has settled yet is
    still listed, as the lazy expiry write has not happened (see ``services.sharing``)."""
    audiences: list[Audience] = []
    surface = session.get(PublicSurface, trip_id)
    if surface is not None and (reach != Reach.DELIVERING or surface.state == SurfaceState.PUBLISHED):
        audiences.append(PublicAudience(surface))
    states = {Reach.STORED: None, Reach.OPEN: OPEN_STATES, Reach.DELIVERING: (LinkState.ACTIVE,)}[reach]
    links = select(ShareLink).where(ShareLink.trip_id == trip_id).order_by(ShareLink.created_at, ShareLink.id)
    members = (
        select(CollectionMember, Collection)
        .join(Collection, Collection.id == CollectionMember.collection_id)
        .where(CollectionMember.trip_id == trip_id)
        .order_by(CollectionMember.created_at, CollectionMember.id)
    )
    if states is not None:
        links = links.where(ShareLink.state.in_(states))
        members = members.where(Collection.state.in_(states))
    audiences.extend(LinkAudience(link) for link in session.scalars(links))
    audiences.extend(MemberAudience(member, collection) for member, collection in session.execute(members))
    return audiences
