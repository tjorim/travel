"""What anonymous delivery shares with the owner's previews: the privacy headers, the path patterns and the lookup of
a file or a navigation target among what a scope delivers.

Nothing here knows of HTTP requests or responses: ``app.http_delivery`` shapes these answers for the routers, and
the MCP tools report them as data.
"""

import re
from dataclasses import dataclass

from ..errors import RecordNotFound
from ..models import StoredObject, Trip
from ..projection import scoped_file, scoped_navigation_url
from ..storage import ObjectStorage

UNLISTED_HEADERS = {
    "Cache-Control": "no-store, private",
    "X-Robots-Tag": "noindex, noarchive",
    "Referrer-Policy": "no-referrer",
}


PATH_PATTERNS = {
    "slug": re.compile(r"[A-Za-z0-9_-]{1,32}"),
    "token": re.compile(r"[A-Za-z0-9_-]{43}"),
    "member_id": re.compile(r"[A-Za-z0-9_-]{1,32}"),
    "local_id": re.compile(r"[A-Za-z0-9_-]{1,80}"),
}

# Displayed in the page; everything else is offered as a download.
INLINE_TYPES = {"image/jpeg", "image/png", "image/webp", "video/mp4"}


@dataclass(frozen=True)
class DeliveredFile:
    """A file the scope delivers: its stored object and how a visitor's browser may show it."""

    stored: StoredObject
    disposition: str

    @property
    def content_type(self) -> str:
        return self.stored.content_type


def delivered_file(trip: Trip, scope: dict, local_id: str) -> DeliveredFile:
    """The file a projection-local marker names among what ``scope`` delivers, or a not-found refusal."""
    resolved = scoped_file(trip, scope, local_id)
    if resolved is None:
        raise RecordNotFound("File not found")
    kind, stored = resolved
    inline = kind == "media_derivative" and stored.content_type in INLINE_TYPES
    return DeliveredFile(stored, "inline" if inline else "attachment")


def inspect_delivered_file(trip: Trip, scope: dict, local_id: str, storage: ObjectStorage) -> dict[str, str | None]:
    """Confirm a delivered file can be read from storage and report how it would be served, without its bytes."""
    found = delivered_file(trip, scope, local_id)
    with storage.open(found.stored.object_key):
        pass
    return {"content_type": found.content_type, "cache_control": UNLISTED_HEADERS["Cache-Control"]}


def navigation_target(trip: Trip, scope: dict, local_id: str) -> str:
    """The destination a projection-local navigation marker names among the delivered places."""
    target = scoped_navigation_url(trip, scope, local_id)
    if target is None:
        raise RecordNotFound("Navigation target not found")
    return target
