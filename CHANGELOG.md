# Changelog

All notable changes to the travel hub are documented here.

## Unreleased

### Added

- Owner-facing tracker controls for the public projection and named unlisted
  links. Each surface has a field-level `travel/share-scope@1` editor and
  server-rendered preview so an owner can inspect the exact delivered
  projection before publishing or sharing it. Named links can be created,
  edited, activated, revoked and rotated from the PWA. The raw capability is
  shown only from its activation/rotation response, kept only in component
  memory, and can be copied before the owner dismisses it; the app never
  fetches or persists it. ([#99](https://github.com/tjorim/travel/issues/99))

- Private tracker PWA management for ordered route stages, completed-track
  uploads and independently authored broad routes. Route stages select an
  existing broad place and can be reordered or removed without position
  conflicts. Track input is deliberately a finished GPX or JSON point-array
  file with bounded start/end times; the PWA contains no recording or
  background-location control. Raw files remain behind the authenticated
  owner endpoint, while broad-route lines are entered and saved separately
  from any raw track. ([#94](https://github.com/tjorim/travel/issues/94))

- Private tracker PWA workflows for creating, editing and deleting exact
  stays and separately authored broad-stay cards, plus uploading, viewing and
  deleting owner-only document originals. A redacted document copy must be
  uploaded with its redaction manifest, starts pending, and receives a clear
  explicit-approval action before it can be selected for a later share scope.
  File previews are fetched with the owner's authorization into a temporary
  browser object URL; the PWA does not put either originals or exact-stay data
  on a public or unlisted route. ([#95](https://github.com/tjorim/travel/issues/95))

- Private tracker PWA workflows for listing, creating, editing and deleting
  trips; capturing, editing and deleting canonical moments; and authoring,
  editing and deleting separately written moment excerpts. Exact places are
  searched or reverse-geocoded only through the owner-only OSM endpoints and
  are saved only after the owner selects and saves a moment; photo EXIF date
  and place suggestions remain separate, explicit actions. Broad places are
  authored without raw-coordinate entry and selected deliberately for an
  excerpt. Private media attachments, canonical moments, exact places and
  EXIF suggestions remain within authenticated tracker responses. ([#96](https://github.com/tjorim/travel/issues/96))

- Configurable, attributed owner-only OSM place search with a bounded
  in-memory confidential-query cache, durable OSM element type/ID references,
  and owner-selected display snapshots for exact places. Explicit reverse
  geocoding returns only a selectable candidate and never auto-creates a
  place, allowing a later owner-confirmed EXIF suggestion flow. Google Maps links are
  generated after owner or public/unlisted scope resolution: exact targets
  need an explicit `exact_place` navigation capability, while broad selected
  places only produce city-level destinations. Public and unlisted projections
  expose neither OSM references, coordinates, viewports, display snapshots nor
  direct Google URLs. ([#39](https://github.com/tjorim/travel/issues/39))

- Replaced the legacy public/unlisted route-stage and moment ID lists with
  the versioned `travel/share-scope@1` item allowlist. Public and unlisted
  projections now support explicitly selected route stages, broad places,
  broad routes, moment excerpts, broad stay cards, approved media derivatives
  and approved document derivatives, exposing only fields requested by the
  scope. Projection IDs are local to the response; originals, exact places,
  stays, raw tracks and unapproved/deleted derivatives remain unavailable.
  The accompanying data migration assumes no persisted production scopes and
  safely drops legacy moment selections, which cannot be represented by the
  share-safe moment-excerpt resource. ([#60](https://github.com/tjorim/travel/issues/60))

- Owner-managed `travel/document@1` originals and separately supplied
  `travel/document-derivative@1` redacted copies in the tracker API, with an
  Alembic migration and owner-only upload/list/delete/delivery endpoints.
  Every original, redacted copy and JSON redaction manifest is copied through
  the checksum-verified `StoredObject` pipeline. A derivative cannot reuse an
  original's bytes, begins in `pending` review, and requires explicit owner
  approval before a future share scope may use it; no public or unlisted
  document-delivery route exists in this phase. ([#59](https://github.com/tjorim/travel/issues/59))

- Owner-only `travel/recorded-track@1` and separately authored
  `travel/broad-route@1` resources in the tracker API, with an Alembic
  migration and owner endpoints. A complete GPX or JSON point-array upload
  requires bounded start/end times and is copied through the existing
  checksum-verified `StoredObject` pipeline; there are no partial, streaming
  or live-tracking endpoints. Raw track points and timestamps are retrievable
  only by the owner, never through public or unlisted delivery. A broad route
  stores an owner-reviewed GeoJSON line and date precision independently of a
  raw track, so shareable geometry is never derived at request time. Tests
  cover ownership, bounded uploads, and public-surface non-disclosure. Third
  of #38's seven delivery phases. ([#58](https://github.com/tjorim/travel/issues/58))

- Owner-managed `travel/stay@1` and separately authored
  `travel/broad-stay-card@1` resources in the tracker API, with an Alembic
  migration and owner CRUD endpoints. A stay retains its exact place, exact
  arrival/departure times, property, booking/contact details and notes behind
  the owner boundary. A broad stay card instead contains only an explicit
  broad place, title and date precision; it has no stay link, so it cannot
  disclose exact-place, date or booking data through a later projection.
  Authorization and no-leak regression tests cover both resource types.
  Second of #38's seven delivery phases. ([#57](https://github.com/tjorim/travel/issues/57))

- Split the tracker API's flat MVP `Place` into the canonical
  `travel/place@1` model: an `exact` place (address parts, coordinates,
  viewport, navigation/provider IDs, owner-only notes) or a `broad` place
  (label, country/region, optional approved generalized point), with an
  optional `parent_exact_place_id` for owner traceability that never appears
  in a shared response. A route stage now always references a `broad`
  place; a moment always references an `exact` place. Added the standalone
  `moment_excerpt` resource (`travel/moment-excerpt@1`) with owner
  create/edit/delete endpoints: `source_moment_id` is optional owner-only
  provenance, so an excerpt outlives a deleted journal item, and
  `broad_place_id` must reference a `broad` place on the same trip. Since a
  moment's place is now always `exact`, the public/unlisted projection no
  longer surfaces any place for a shared moment rather than leaking address
  or coordinate data. No production data exists yet, so the accompanying
  migration is a clean recreate of `places`, `route_stages` and `moments`
  rather than a data-preserving one. First of #38's seven delivery phases,
  per #37's canonical content model. ([#56](https://github.com/tjorim/travel/issues/56))

- Owner-only audit trail for the tracker API's publication and share-link
  lifecycle: an `audit_events` table records every public-projection
  publish/unpublish and every share-link create/activate/revoke/rotate, plus
  a link's natural expiry, with the link/projection id, owner action, a
  scope fingerprint, and an optional owner-entered reason. An event never
  stores a raw capability token, recipient identity, or recipient IP — a
  natural expiry (discovered on an anonymous request) is attributed to a
  `system` actor rather than the anonymous token holder. A new owner-only
  `GET /trips/{trip_id}/audit-events` endpoint reads a trip's history; a
  non-owner gets the same 404 as any other trip they don't own.
  `purge_expired_audit_events` (`api/app/audit.py`) hard-deletes events past
  the sharing policy's 24-month retention window as pure application code,
  run manually for v1; recurring VPS scheduling is tracked separately.
  ([#48](https://github.com/tjorim/travel/issues/48))

- Durable, owner-only media ingestion for the tracker API: direct device
  upload as the always-available fallback, a Google Photos Picker session
  flow that imports only items the owner explicitly selected in Google's own
  UI, and a GoPro Cloud adapter behind the same provider interface, gated
  off by default until beta API access is granted so the product remains
  fully usable without it. Every imported or uploaded file is copied into
  Travel-controlled object storage and checksum-verified before it becomes a
  canonical `MediaAsset`; storage and import provenance both dedup per trip
  (`sha256`, and `provider`+`provider_item_id`), so retrying an interrupted
  import reattempts only the items that failed and never creates a duplicate
  record. Provider access tokens live only in a process-local secret store,
  never in the database or an API response. Originals and their raw
  EXIF/XMP/IPTC stay owner-only and are never modified on ingest; a
  best-effort read of each photo's capture time, camera and GPS is kept
  alongside the untouched original (`MediaAsset.captured_at` and
  `raw_metadata.exif`) so the owner can pre-fill a moment's date or place
  without re-parsing the file, preferring the file's own EXIF
  `DateTimeOriginal` over a provider's capture-time metadata when both exist.
  A stripped, resized derivative is generated only on explicit owner request
  and starts `pending` owner review, which is the gate a future share scope
  must satisfy before it can ever be projected publicly. Deletion is a soft
  delete honoring the 30-day recoverable-deletion policy, with a dedup-safe
  purge helper for objects nothing else references.
  ([#43](https://github.com/tjorim/travel/issues/43))

- Scoped, revocable public and unlisted publication links for the tracker
  API. Owners select an explicit scope (route stages, moments, optional
  title/summary) for the public follower view or a named unlisted link; both
  the scope and the content it selects are live, so adding, removing, or
  editing an item reaches visitors on their next request with no republish
  step, while an item outside the scope still never appears. What requires a
  deliberate owner action is only whether a page is served at all:
  publish/unpublish for the public view, activate/revoke/rotate for a named
  link. Named unlisted links use 256-bit
  capability tokens with a keyed, one-way verifier (the raw token is
  returned once and never stored) and a 1-90 day (default 30) expiry;
  revoking or rotating a link invalidates its token immediately. Unlisted
  delivery responses carry
  `Cache-Control: no-store, private`, `X-Robots-Tag: noindex, noarchive` and
  `Referrer-Policy: no-referrer`, including on a not-found/expired/revoked
  response. ([#42](https://github.com/tjorim/travel/issues/42))

- Versioned canonical-model and archive-publication design for the Travel
  application. It specifies owner-scoped content, files in backed-up VPS object
  storage, separate broad/derived share records, immutable public and unlisted
  projections, capability and static-export states, media-import records, and
  a one-time legacy static-archive migration path.
  ([#37](https://github.com/tjorim/travel/issues/37))

- Versioned the Travel privacy, sharing and offline policy. It defines
  private-by-default public follower views and fine-grained named-share-link
  projections for every v1 resource, response redaction, capability lifecycle
  and revocation, device-scoped offline-copy behavior, and retention/encryption
  expectations.
  ([#36](https://github.com/tjorim/travel/issues/36))

- A reusable, data-driven local-route map component for private itineraries.
  It supports airport, stay and ground-route stops; road, rail, flight and
  mountain route styles; keyboard-selectable stops; and a textual route
  equivalent. Taiwan now supplies its local map through this component. ([#3](https://github.com/tjorim/travel/issues/3))

- Explicit, per-document offline saving for private documents. The root-scoped
  service worker is network-first and serves only manually saved local copies
  offline; the document list includes saved status, removal, and clear-all
  controls with an on-device storage warning. ([#4](https://github.com/tjorim/travel/issues/4))

- Git-native public photo workflow: Git LFS camera-original layout, a strict
  public media manifest with alt text, captions and focal points, responsive
  gallery/timeline-media components, and metadata-free WebP preparation.
  ([#9](https://github.com/tjorim/travel/issues/9))
- A repeatable public-route safety check for pre-deployment review of
  operational data, media GPS metadata, public/private file boundaries, and
  cache/indexing recovery after an accidental exposure.
  ([#10](https://github.com/tjorim/travel/issues/10))
- Privacy-first tracker MVP decision and FastAPI core for owner-scoped trips,
  route stages, moments, broad places, explicit publication, a read-only public
  endpoint, Alembic migration, and API tests. It has no media storage or GPS
  collection. ([#20](https://github.com/tjorim/travel/issues/20),
  [#22](https://github.com/tjorim/travel/issues/22))
- Installable React tracker shell under `/tracker/`, with isolated client-side
  refresh routing, accessible mobile navigation, empty account boundary, and a
  minimal app-shell cache. ([#21](https://github.com/tjorim/travel/issues/21))
- Authorization-code sign-in with S256 PKCE for the tracker, keeping access
  tokens in the browser session only and sending them solely to the tracker
  API. The account identity stays out of published-trip responses.
  ([apps#216](https://github.com/tjorim/apps/issues/216))
- Mobile moment capture in the tracker, with date/time and text editing,
  trip-level sharing visibility, locally queued drafts, honest offline status,
  and a deliberate broad-place choice. The optional browser location action is
  one-shot and immediately discards coordinates; it never sends or stores GPS
  data, and drafts are not automatically synchronized. Moments can also have a
  saved place removed while editing. ([#23](https://github.com/tjorim/travel/issues/23))

- Native server-side login and logout flow for shared and per-trip private
  routes, with short-lived signed secure sessions, Argon2id secret handling,
  Caddy forward-auth configuration, and central-infrastructure deployment.
  ([#11](https://github.com/tjorim/travel/issues/11),
  [apps#214](https://github.com/tjorim/apps/issues/214))
- Trip-specific private document-library route and `manifest.json` convention
  for Exampleland 2054.
- Per-trip `public/trip.json` and protected `private/trip.json` contract,
  documented in the repository and implemented for Exampleland 2054.
- Reusable trip-story and private trip-header components that load data from
  their corresponding static content files. ([#6](https://github.com/tjorim/travel/issues/6))
- Versioned public and private trip-data schemas, reusable card/timeline/
  booking renderers, and a small data-driven reference trip. ([#2](https://github.com/tjorim/travel/issues/2))
- Public, mobile-first Taiwan travel timeline with stable per-moment fragment
  URLs, rendered solely from the deliberately selected `public/trip.json`
  content. ([#7](https://github.com/tjorim/travel/issues/7))
- Public route/places map with full, city-level and no-map modes, public-data
  safety guidance, route stages and a visible textual route equivalent.
  ([#8](https://github.com/tjorim/travel/issues/8))

### Changed

- Document listings now display the document's trip association alongside its
  type, validity date and description.

## 2026-09-21

### Added

- Static Exampleland 2054 public overview and protected detailed itinerary.
- Travel-hub landing page structured for future trips.
- Shared protected `/private/` area for general travel documents and emergency
  information.
- Git-backed document manifest and in-app native document preview component.
- Reusable international flight-map component with Taiwan AMS ↔ TPE flight data.
- Reusable travel-component directory at `dist/assets/travel/`.
- Public/private trip-data planning and implementation backlog.

### Changed

- Renamed the repository and apps submodule from `exampleland-2054` to `travel`.
- Expanded Caddy protection from only trip-private pages to both `/private/`
  and every `/<trip>/private/` route.
- Deployed `travel.tjor.im`; its public route is live and private routes are
  protected by the VPS-managed credential.
  ([#5](https://github.com/tjorim/travel/issues/5))
