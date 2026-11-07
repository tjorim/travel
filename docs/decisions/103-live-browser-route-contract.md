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
| Public index | `/` or `/trips/` | Load a data-free landing shell, then request `GET /api/public/trips`. Only currently published surfaces appear; each card carries its stable public slug and scope-approved title and summary. |
| Public visitor | `/trips/{slug}` | Load the anonymous page shell, then request only `GET /api/public/trips/{slug}` for trip content. Render the returned `travel/public-trip@1` document. |
| Unlisted visitor | `/share/{token}` | Load the anonymous page shell, then request only `GET /api/shared/{token}` for trip content. Render the returned `travel/unlisted-trip@1` document. |
| Collection visitor | `/share/{token}` and `/share/{token}/trips/{member_id}` | The same `/share/` shell. `GET /api/shared/{token}` returns either an unlisted trip or a `travel/collection@1` index of members; the index links to `/share/{token}/trips/{member_id}`, which requests only `GET /api/shared/{token}/trips/{member_id}` and renders its `travel/unlisted-trip@1` document. `{member_id}` is a collection-local opaque ID, never a trip ID. Files and navigation use `/api/shared/{token}/trips/{member_id}/files/{local_id}` and `/navigation/{local_id}`. All have the unlisted protections below, and an unknown, expired or revoked collection, and an unknown member, show the same unavailable page. See decision [36](36-privacy-sharing-offline-policy.md#collection-links). |

The listing uses `Cache-Control: no-store` and excludes draft, private and
unlisted surfaces. An empty response shows an empty state; a failed request
shows an error and retry. The public slug comes from the published public surface. The unlisted token is
a high-entropy owner-managed URL value, retrievable only through owner-authenticated link management. Both
visitor pages use the same projection renderer, with no authenticated owner
session requirement. They never request `/api/trips/{trip_id}` or owner
previews. The pre-launch `/api/published/trips/{public_id}` endpoint has been
removed; it creates no URL compatibility promise.
Projection-local IDs are display and navigation references, not permission to
fetch canonical records. A selected
navigation marker may use the corresponding scoped `/api/public/trips/{slug}/navigation/{local_id}`
or `/api/shared/{token}/navigation/{local_id}` endpoint; the API checks its
scope again before redirecting. Selected `image` and `file` markers may use
`/api/public/trips/{slug}/files/{local_id}` or
`/api/shared/{token}/files/{local_id}`. These routes recheck the live scope,
approval and publication or capability state before delivering derivative
bytes; originals and redaction manifests have no visitor route.

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
  be cached as code, but must contain no trip data; a published trip's link-preview
  metadata ([below](#link-previews)) is the one exception and is never cached. Public page indexing is
  allowed only for a published page; unpublished pages must not expose cached
  content.
- The unlisted HTML shell and every capability-dependent response, including
  unavailable responses, use `Cache-Control: no-store, private`,
  `Referrer-Policy: no-referrer`, and `X-Robots-Tag: noindex, noarchive`.
  The shell also includes a no-referrer meta policy before any subresource and
  loads no third-party resource that could receive the URL. The one exception
  is the story map, which requests styles, tiles, fonts and, only when the
  visitor enables them, terrain and satellite imagery from OpenFreeMap,
  Mapterhorn and Esri. Those requests use `referrerPolicy: no-referrer` and
  omitted credentials, never contain the token or an API path, and reveal the
  viewed region and the visitor's IP address to the provider; the page says so
  beside the map. A token in the
  path must be excluded from application and proxy access logs, analytics,
  telemetry, error reporting and external link referrers.
- The browser keeps an unlisted token in the current URL and transient memory
  for its request, and, as decision [36](36-privacy-sharing-offline-policy.md)
  permits, in one device-local convenience list. Opening a valid link saves
  exactly four values in `localStorage` key `travel-saved-shared-trips@1`: the
  token, the delivered trip title, the delivered one-line summary and the time
  of the last visit (at most 30 entries). The list is never sent anywhere,
  never indexed and is revalidated against `GET /api/shared/{token}`; a `403` or
  `404` removes the entry. The page shows a notice at every open that the link
  is saved on this browser, with a **Forget this link** control, and the
  homepage list offers Forget and Forget all. The browser does not put tokens
  or projection bodies in sessionStorage, IndexedDB, Cache Storage,
  service-worker caches, persisted state or browser analytics, and does not
  store anything else from the projection. The owner `/admin/`
  service worker stays scoped to `/admin/` and must not control visitor
  pages. Client navigation away from a share page clears its in-memory
  projection.
- The visitor shell must not embed trip data, token metadata, owner
  credentials, or owner API responses in HTML or JavaScript bundles, except the
  link-preview metadata a published public trip's own `/trips/{slug}` response
  carries, which is limited to what the public projection already delivers. The API
  validates the public publication state or unlisted capability and applies
  the stored field and item allowlist on every request. No generated static
  trip artifact participates in live delivery.

The browser routes and response headers above are requirements for #102 and
the VPS routing work in tjorim/apps#219. This repository's API tests cover
the delivery behavior available now. The fresh-launch boundary and absence of
archive migration or URL aliases are defined by #101. Any later work on old
static archive content is tracked separately in #40.

## Link previews

Decision VD2 (2026-11-06, [#245](https://github.com/tjorim/travel/issues/245)):
a published public trip shows a trip-specific preview, and a hidden link stays
generic. Chat apps build a preview from the HTML they are served without running
JavaScript, so `/trips/{slug}` must reach the API for its `<head>`.

- **Delivery route.** `GET /api/public/trip-shell/{slug}` returns the built,
  data-free `public.html` (`TRAVEL_VISITOR_SHELL_DIR`, the same `dist` the
  proxy serves) with trip-specific metadata. The proxy sends `/trips/{slug}`
  (one slug of 1–32 `A-Za-z0-9_-` characters, with or without a trailing
  slash) there and keeps serving `public.html` as a static file for `/trips/`
  and every other path (`Caddyfile.example`; production in `tjorim/apps`
  [#219](https://github.com/tjorim/apps/issues/219)). The page, its bundle and
  its API request are unchanged: the shell still embeds no trip data.
- **What it may show.** It is built from `render_projection` of the live public
  scope, so it is exactly what `GET /api/public/trips/{slug}` already
  delivers, and nothing else. The title (`<title>`, `og:title`,
  `twitter:title`, as "Title · Travel", cut to 70 characters) only if the scope
  shares the title; the one-line plain-text summary (`description`,
  `og:description`, `twitter:description`, cut to 200 characters) only if the
  scope shares the summary; `og:url` as the page's public URL. The cover
  (`og:image`, `twitter:image` with its alt text and, when known, size) is set
  only when the public audience already receives that photo
  (`projection._cover`), and its URL is the scoped public file route of that
  copy, `/api/public/trips/{slug}/files/{local_id}`, never an owner route, a
  canonical id, an object key, a hidden-link route or an unapproved or private
  derivative. A field the scope does not share keeps the shell's generic
  value; with no shared cover the generic brand image stays.
- **Absolute URLs.** Chat apps need absolute URLs. They are built from the
  configured `TRAVEL_PUBLIC_APP_URL`, never from the `Host` or forwarded
  headers, which a caller controls.
- **Everything else is generic and indistinguishable.** An unknown, malformed
  (not 1–32 `A-Za-z0-9_-` characters), unpublished or revoked slug returns the
  unchanged shell with the same status, headers and body, so the preview
  confirms nothing the public API (`404`) does not already say. Malformed slugs
  skip the database as the other public routes do. A missing shell file is a
  `503` (`shell_unavailable`) and never a trip-specific page.
- **Escaping.** Every value is HTML-escaped for an attribute or text, control
  characters and newlines are folded to spaces, and the length limits above
  apply. No private field, owner id, canonical id, date, place or document is
  read.
- **Caching.** Every response, trip-specific or generic, sends
  `Cache-Control: no-store` (and `X-Content-Type-Options: nosniff`), with no
  `ETag`, `Last-Modified` or cookie. The body depends on live publication state,
  so a browser or shared cache must not reuse it: an unpublish, revoke or scope
  change shows on the next fetch, like the projection API. `Vary` is not needed
  because the output depends on the path only. A chat app's own preview cache is
  outside our control; the safety check says so.
- **Indexing.** The shell keeps `noindex, noarchive`; a preview does not make a
  page indexable.
- **Hidden links.** `/share/{token}` keeps the static `share.html`, generic
  metadata, `noindex`, `no-referrer` and `no-store`. No link preview path reads
  a token or a link's scope.

## Visitor shell build handoff

The frontend build emits data-free `landing.html`, `public.html` and `share.html` beside the
owner `index.html`. The VPS route owner in tjorim/apps#219 serves `landing.html`
for `/`, `public.html` for `/trips/` (a single `/trips/{slug}` is rendered from it by the API, see
[Link previews](#link-previews)), and `share.html` for `/share/{token}`, with a direct reload
returning the same shell. The built assets are under `/admin/assets/`; the
visitor entry point neither registers the owner service worker nor reads its
session. The unlisted shell must receive the protective response headers above
even for an unknown token. The public shell starts with `noindex`, and keeps it when the API adds a
published trip's link-preview metadata.
