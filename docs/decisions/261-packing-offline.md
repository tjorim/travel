# Packing workspace offline decision

The owner packing workspace uses authenticated API reads and writes. A failed packed-state write stays visible locally with an explicit retry action, but it is not a durable offline edit. Reloading or leaving the page can discard that pending choice.

The existing encrypted, device-scoped offline store provides owner-selected, read-only document, media, map and itinerary snapshots. Packing should follow that pattern: an owner may opt to save a view-only packing snapshot, while checking, moving and editing items require a connection. The offline view must show when the copy was saved and must not imply that an offline tap changed the canonical list.

Issue #261 ships the online owner workflow. Issue #266 adds opt-in, view-only packing copies under the existing privacy policy. A copy contains the list, bags, items and packed states from a fresh owner API read. The saved timestamp describes those bytes; reconnect revalidates access and the lease, while the owner explicitly refreshes the copy after edits.
