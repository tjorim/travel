# Live browser route and projection contract

This is the browser contract for the live Travel views in #73. The API is the
only authorization and redaction boundary. The visitor shell and renderer in
#102 and #100 implement this contract; this decision does not deploy those
routes. The fresh-launch route boundary is specified by
[the revised #101 decision](101-legacy-route-transition.md).

## Routes and request sequence

| Audience | Browser route | Request sequence |
|---|---|---|
| Owner | `/admin/trips` (within the `/admin/` PWA) | Sign in through the existing owner flow, request `GET /api/trips`, then request owner-authenticated `/api/trips/{trip_id}/*` resources for the selected trip. Owner publication controls may request `GET /api/trips/{trip_id}/public-projection`, `GET /api/trips/{trip_id}/share-links`, and owner-only preview POSTs. |
| Public visitor | `/trips/{slug}` | Load the anonymous page shell, then request only `GET /api/public/trips/{slug}` for trip content. Render the returned `travel/public-trip@1` document. |
| Unlisted visitor | `/share/{token}` | Load the anonymous page shell, then request only `GET /api/shared/{token}` for trip content. Render the returned `travel/unlisted-trip@1` document. |

The public slug comes from the published public surface. The unlisted token is
the one-time value returned to the owner on link activation or rotation. Both
visitor pages use the same projection renderer, with no authenticated owner
session requirement. They never request `/api/trips/{trip_id}` or owner
previews. The pre-launch `/api/published/trips/{public_id}` endpoint has been
removed; it creates no URL compatibility promise.
Projection-local IDs are display and navigation references, not permission to
fetch canonical records. A selected
navigation marker may use the corresponding scoped `/api/public/trips/{slug}/navigation/{local_id}`
or `/api/shared/{token}/navigation/{local_id}` endpoint; the API checks its
scope again before redirecting. Derivative delivery requires its own scoped
API route before the browser may display derivative bytes.

The shell shows a loading state until the projection request completes. A
successful response is rendered as received; the browser does not request a
full trip and hide fields. A public 404 shows a generic unavailable page. For
an unlisted route, unknown, expired and revoked capabilities all show the same
unavailable page, without reason, link metadata, a login prompt, or a fallback
to owner or static archive content. A network failure offers a retry but does not
claim the capability is invalid. Retrying repeats the scoped request, so a
revoke or scope edit is checked again by the API.

## Browser and delivery protections

- The public projection API response uses `Cache-Control: no-store`, so an
  unpublish or scope change is checked on the next load. The public shell may
  be cached as code, but must contain no trip data. Public page indexing is
  allowed only for a published page; unpublished pages must not expose cached
  content.
- The unlisted HTML shell and every capability-dependent response, including
  unavailable responses, use `Cache-Control: no-store, private`,
  `Referrer-Policy: no-referrer`, and `X-Robots-Tag: noindex, noarchive`.
  The shell also includes a no-referrer meta policy before any subresource and
  loads no third-party resource that could receive the URL. A token in the
  path must be excluded from application and proxy access logs, analytics,
  telemetry, error reporting and external link referrers.
- The browser keeps an unlisted token only in the current URL and transient
  memory needed for its request. It does not put tokens or projection bodies
  in localStorage, sessionStorage, IndexedDB, Cache Storage, service-worker
  caches, persisted state, or browser analytics. The owner `/admin/`
  service worker stays scoped to `/admin/` and must not control visitor
  pages. Client navigation away from a share page clears its in-memory
  projection.
- The visitor shell must not embed trip data, token metadata, owner
  credentials, or owner API responses in HTML or JavaScript bundles. The API
  validates the public publication state or unlisted capability and applies
  the stored field and item allowlist on every request. No generated static
  trip artifact participates in live delivery.

The browser routes and response headers above are requirements for #102 and
the VPS routing work in tjorim/apps#219. This repository's API tests cover
the delivery behavior available now. The fresh-launch boundary and absence of
archive migration or URL aliases are defined by #101. Any later work on old
`dist/` content is tracked separately in #40.

## Visitor shell build handoff

The tracker build emits data-free `public.html` and `share.html` beside the
owner `index.html`. The VPS route owner in tjorim/apps#219 serves `public.html`
for `/trips/{slug}` and `share.html` for `/share/{token}`, with a direct reload
returning the same shell. The built assets are under `/admin/assets/`; the
visitor entry point neither registers the owner service worker nor reads its
session. The unlisted shell must receive the protective response headers above
even for an unknown token. The public shell starts with `noindex` because it
contains no server-rendered publication state or trip content.
