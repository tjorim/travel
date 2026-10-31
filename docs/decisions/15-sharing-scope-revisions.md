# Sharing Scope Revisions

Decision: 2026-10-30, issue #15. Only owner sharing selections have stale-write
protection. Trips, tasks, updates, packing and all other owner records retain
last-write-wins semantics. Shared-location editing is covered by
[32-shared-location-edits.md](32-shared-location-edits.md).

Owner public-projection status and share-link responses expose an integer
revision. PUT public-projection and PATCH share-links/{id} accept one quoted
strong revision in If-Match. An atomic database UPDATE compares and advances
the revision before applying changes. A stale revision returns 412 with
detail.code = scope_revision_conflict and detail.current containing the current
owner response. Neither the token nor that owner response is added to visitor
projections. Preview endpoints remain token-free and do not advance revisions.

Missing If-Match remains an unconditional write for compatibility with existing
MCP tools and API clients; it still advances the revision, invalidating older
PWA drafts. MCP tools call the route functions directly and remain compatible.
Label-only share-link PATCH also advances the link revision, so choosing the
server copy restores the complete editor record.

The PWA retains the revision loaded with the draft. On conflict it shows the
server selection without resetting the guarded form. Keep My Draft adopts the
current revision for a subsequent explicit save; Use Server Selection resets
the editor to the server value. A later concurrent edit can produce another
conflict rather than being overwritten silently.
