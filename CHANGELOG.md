# Changelog

All notable changes to the travel hub are documented here.

## Unreleased

### Added

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
