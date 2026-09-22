# Travel tracker API

The tracker API is a separate FastAPI application; it does not replace the
static archive or read its JSON, documents, or protected files.

## API contract

Application routes use the unversioned `/api` prefix. Owner routes require a
bearer token whose validated OpenID Connect `sub` matches the trip owner:

| Method | Route | Purpose |
|---|---|---|
| `GET`, `POST` | `/trips` | List the caller's trips or create a private trip. |
| `GET`, `PATCH`, `DELETE` | `/trips/{trip_id}` | Read, edit, or remove an owned trip. |
| `POST` | `/trips/{trip_id}/route-stages` | Add a broad route stage. |
| `PATCH`, `DELETE` | `/trips/{trip_id}/route-stages/{stage_id}` | Edit or remove a route stage. |
| `POST` | `/trips/{trip_id}/moments` | Add a chronological moment. |
| `PATCH`, `DELETE` | `/trips/{trip_id}/moments/{moment_id}` | Edit or remove a moment. |
| `POST` | `/trips/{trip_id}/places/search` | Owner-only OSM search; returns attribution and a selected-result snapshot. |
| `POST` | `/trips/{trip_id}/places/reverse` | Owner-only, explicit coordinate-to-place suggestion; never writes a place. |
| `GET`, `POST` | `/trips/{trip_id}/places` | List or save owner-only exact places. |
| `GET` | `/trips/{trip_id}/places/{place_id}/navigation` | Generate an owner-authorized exact Google Maps destination. |
| `PUT` | `/trips/{trip_id}/public-projection` | Replace the trip's public scope; live immediately if already published. |
| `POST` | `/trips/{trip_id}/public-projection/preview` | Render the current scope for owner review (`no-store`), no gate. |
| `POST` | `/trips/{trip_id}/public-projection/publish` | Start serving the trip publicly at its current scope. |
| `POST` | `/trips/{trip_id}/public-projection/unpublish` | Stop serving the trip publicly. |
| `GET` | `/trips/{trip_id}/public-projection` | Read the current scope and publish state. |
| `POST`, `GET` | `/trips/{trip_id}/share-links` | Create or list named unlisted share links. |
| `GET`, `PATCH` | `/trips/{trip_id}/share-links/{link_id}` | Read, or edit a link's label/scope (draft or active; live once active). |
| `POST` | `/trips/{trip_id}/share-links/{link_id}/preview` | Render a link's current scope for owner review, no gate. |
| `POST` | `/trips/{trip_id}/share-links/{link_id}/activate` | Mint the capability token for a draft link (returned once). |
| `POST` | `/trips/{trip_id}/share-links/{link_id}/revoke` | Immediately invalidate an active link's token. |
| `POST` | `/trips/{trip_id}/share-links/{link_id}/rotate` | Revoke the current token and issue a fresh one for the same scope. |
| `GET` | `/public/trips/{slug}` | Anonymous: read the trip's current public scope, rendered live. |
| `GET` | `/shared/{token}` | Anonymous: exchange a valid, unexpired, non-revoked capability for its current scope, rendered live. |
| `GET` | `/public/trips/{slug}/navigation/{local_id}` | Redirect a selected public projection navigation marker to Google Maps. |
| `GET` | `/shared/{token}/navigation/{local_id}` | Redirect a selected unlisted projection navigation marker to Google Maps. |
| `POST` | `/trips/{trip_id}/media/uploads` | Direct device upload (multipart); the durable fallback path, always available. |
| `GET` | `/trips/{trip_id}/media` | List the trip's owner-only media assets. |
| `POST` | `/trips/{trip_id}/media/visit-candidates` | Calculate transient visit-review groups for media explicitly selected by the owner; never writes canonical data. |
| `GET`, `DELETE` | `/trips/{trip_id}/media/{media_id}` | Read or soft-delete a media asset. |
| `GET` | `/trips/{trip_id}/media/{media_id}/original` | Owner-only, `no-store` original file delivery. |
| `POST`, `GET` | `/trips/{trip_id}/media/{media_id}/derivatives` | Generate or list stripped/resized derivatives for share/static-export/owner-preview. |
| `DELETE` | `/trips/{trip_id}/media/{media_id}/derivatives/{derivative_id}` | Permanently remove a generated derivative and withdraw it from every live share scope. |
| `POST` | `/trips/{trip_id}/media/{media_id}/derivatives/{derivative_id}/approve` | Owner review sign-off; only an approved derivative may ever be referenced by a share scope. |
| `GET` | `/trips/{trip_id}/media/{media_id}/derivatives/{derivative_id}/file` | Owner-only, `no-store` derivative file delivery. |
| `POST` | `/trips/{trip_id}/media/imports/{provider}/sessions` | Start a Google Photos Picker or GoPro Cloud selection session. |
| `POST` | `/trips/{trip_id}/media/imports/{provider}/sessions/{session_id}/complete` | Import every item the owner selected; safe to retry after a partial failure. |
| `GET` | `/provider-tokens` | Owner-only non-secret connection status for each import provider. |
| `PUT`, `DELETE` | `/provider-tokens/{provider}` | Connect or revoke the owner's Google Photos/GoPro Cloud access token (write-only; never read back). |

`GET /api/health` checks database connectivity. FastAPI publishes the full
OpenAPI description at `/openapi.json` and interactive development docs at
`/docs`; production routing may choose not to expose the latter.

Ownership is an API boundary, not a client convention: a non-owner receives
`404` for an owned resource. Browser delivery uses only the scoped
public/unlisted projection routes above, per
[#42](https://github.com/tjorim/travel/issues/42).
The live browser route and request sequence are defined in
[the browser contract](../docs/decisions/103-live-browser-route-contract.md).

### Scoped public and unlisted publication links

A public or unlisted view never serializes a full trip: it always renders
live from current trip data, filtered to an explicit scope (which route
stages, moments, and title/summary fields the owner selected). Both the scope
and the content it selects are live — an owner can add, remove, or edit the
underlying items at any time, public or already-shared-and-active alike, and
visitors see the change on their next request with no separate republish
step. What *is* gated, and requires a deliberate owner action, is only
whether a page is being served at all: `publish`/`unpublish` for the public
view, and `activate`/`revoke`/`rotate` for a named unlisted link, since those
are the actions that turn access on or off rather than adjust what an
already-granted audience sees. A named unlisted link additionally gets a
256-bit capability token (`secrets.token_urlsafe(32)`) minted at `activate`;
only a keyed HMAC-SHA256 verifier is stored, the raw token is returned once
(at activation or rotation), and it must be handled like a credential (never
logged, analytics-tracked, or placed in page markup). Revoking or rotating a
link, or its expiry (1-90 days, default 30), is enforced on every
`/shared/{token}` request — there is no separate cache to invalidate because
delivery always re-checks live link state, and the response headers
(`Cache-Control: no-store, private`, `X-Robots-Tag: noindex, noarchive`,
`Referrer-Policy: no-referrer`) apply identically to a valid, expired,
revoked, or unknown token so a probe cannot be distinguished by caching or
indexing behavior.
Public projection responses also use `Cache-Control: no-store` so the next
browser load checks the current publication state and scope.

### Private place search and navigation

`POST /trips/{trip_id}/places/search` and the explicit coordinate-to-place
`POST /trips/{trip_id}/places/reverse` are owner-only and default to the
Nominatim OpenStreetMap search backend. Each returns a selectable result with
OpenStreetMap
attribution, a durable OSM `(element type, element ID)` reference, and the
owner-selected display snapshot; Nominatim's result-local `place_id` is never
stored as an application identifier. Saving the selected result creates an
owner-only exact place, including its address, coordinates and viewport. A
reverse lookup is only a suggestion: it does not create or attach a place. It
is intended for an owner-confirmed media-EXIF suggestion flow (#52), never for
automatic capture or canonical writes.

A moment can explicitly reference up to twelve owner-only `media_asset_ids`.
These attachments are private editing context, distinct from `photo_urls` and
share derivatives: they cannot be put in a public or unlisted scope. An owner
may use an attached photo's capture time as a date suggestion or send its GPS
to the explicit reverse endpoint, then choose a returned place before saving
the moment. Neither action creates or changes a moment or exact place on its
own.

`POST /trips/{trip_id}/media/visit-candidates` adds a separate review step
for a set of media the owner selected. It calculates, but does not persist,
candidate visits using a two-hour window anchored at each group’s first
capture time. GPS readings within 500 m share an explicit option; readings
outside that threshold remain separate choices, and media with no capture
time or GPS is omitted rather than guessed into a visit. The response is
owner-only and cannot be referenced from a share scope. Choosing a candidate
can only prefill a local moment draft or explicitly attach the selected
private media to an existing moment. Looking up its GPS still requires the
owner to invoke the normal reverse-geocode endpoint and select the result.

Search text can itself be sensitive. The service sends it only to the
configured provider over HTTPS; it does not log it and keeps results only in a
bounded in-process TTL cache. It intentionally has no database-backed cache,
so restarting the app drops cached confidential queries. The provider registry
is replaceable through `TRAVEL_OSM_PLACE_SEARCH_PROVIDER`; deployments that
need a self-hosted or contracted provider register its factory without changing
the API response contract. Configure a provider-specific user agent and abide
by that provider's acceptable-use and retention terms.

An owner can receive an exact Google Maps destination from the owner route.
Public and unlisted projections instead contain only opaque, projection-local
`navigation` markers. A broad-place marker redirects to a textual city-level
target. An exact-place marker exists only when a scope item explicitly grants
`{"kind":"exact_place", "id":"…", "fields":["navigation"]}`; its
OSM ID, address, coordinates, viewport, display snapshot and Google URL never
appear in the projection. The server resolves that marker and emits the Google
redirect only after checking the public surface or unlisted capability. A
missing, revoked, expired or out-of-scope marker is `404`.

### Media ingestion

Every imported or uploaded file goes through the same copy-verify-record
pipeline (`app/media/service.py`) regardless of source: bytes are hashed,
written to Travel-controlled object storage (`app/storage.py`; a local
filesystem adapter in dev/test, the backed-up VPS media volume in
production), and re-read to verify the checksum before a `MediaAsset` row
ever references them. A provider URL or a device's local file handle is
never the servable reference — `file_url` in every response is always an
owner-authenticated delivery route.

- **Direct device upload** (`POST .../media/uploads`) is the durable
  fallback: it needs neither Google nor GoPro and copies the uploaded bytes
  straight into storage.
- **Google Photos Picker import** starts a session
  (`POST .../media/imports/google_photos_picker/sessions`) that returns a
  `picker_uri` for the owner to open and select items in Google's own UI,
  then `.../sessions/{id}/complete` copies only what was selected. It
  requires a connected token (`PUT /provider-tokens/google_photos_picker`);
  the raw token is held only in the in-process secret store
  (`app/secrets.py`, a placeholder for a real secret manager) and is never
  written to the database or returned by any endpoint.
- **GoPro Cloud import** uses the identical session/complete flow behind
  `TRAVEL_GOPRO_CLOUD_ENABLED`; while beta access is unavailable (the
  default), starting a session returns `409` and the rest of the product —
  direct upload included — stays fully functional.

Completing an import session is safe to call more than once: each selected
item gets its own `ImportRecord` keyed on
`(trip_id, provider, provider_item_id)`, so a retry after a partial failure
only reattempts the items that failed and never creates a duplicate
`MediaAsset` for one that already succeeded. Uploading or importing
identical bytes a second time for the same trip is likewise a no-op:
`StoredObject` dedups on `(trip_id, sha256)`. An `ImportSession`'s
`expires_at` (set from the provider's own session response) is enforced on
`complete`, not just displayed: a session completed after that instant is
transitioned to `expired` and rejected with `409`, the same way an expired
share link is rejected in `/shared/{token}`.

Originals and their raw EXIF/XMP/IPTC are owner-only, and are never modified
on ingest: the stored original keeps every embedded tag byte-for-byte. At
the same time, `direct_upload`/`complete_import_session` best-effort-parse
each photo's EXIF (`app/media/service.py:extract_exif_metadata`) and keep
both: `MediaAsset.captured_at` and a small convenience subset in
`raw_metadata.exif` (camera make/model, decimal-degree GPS) so the owner API
response can pre-fill a moment's date or suggest a place without any client
needing to parse the file itself — a provider's own capture-time metadata
(e.g. Google's `createTime`) is used only as a fallback when a photo has no
usable EXIF `DateTimeOriginal`. This is a read, never a strip: nothing here
touches the file, and the extracted fields only ever appear on owner-only
routes.

A `MediaDerivative` is generated only on explicit owner request
(`POST .../media/{media_id}/derivatives`) — never automatically on
import/upload — by re-encoding the image with Pillow: reopening and saving
without passing an `exif=`/`icc_profile=` argument is what strips metadata,
since Pillow never carries it over implicitly. This is the one copy that
actually loses EXIF, because it's the one a public/unlisted viewer could
reach. A fresh derivative starts `review_state=pending`; only an owner
`.../approve` moves it to `approved`, which is the state a future
share-scope item must reference (`#38`) before it can ever be projected to
a public or unlisted audience.

Deleting a media asset (`DELETE .../media/{media_id}`) is a soft delete: it
disappears from owner queries immediately, matching the 30-day recoverable-
deletion policy. `app/media/service.py:purge_deleted_media` hard-deletes
media past that window and reclaims any of their stored objects nothing
else still references (dedup-safe); wiring it to a scheduled job is v2
infrastructure work, not part of this application-only issue.

### Connecting the Google Photos Picker provider

There is no owner-facing OAuth consent screen yet — that's tracker UI work
(`#38`), tracked separately in `#55` for the connect/refresh flow itself.
Until then, connecting the provider is a manual, one-time-per-token setup:

1. In a Google Cloud project, enable the **Google Photos Picker API** and
   configure an OAuth 2.0 client (see
   [Get started with the Picker API](https://developers.google.com/photos/picker/guides/get-started-picker)).
2. Obtain an OAuth 2.0 access token authorized for the
   `https://www.googleapis.com/auth/photospicker.mediaitems.readonly` scope
   — for local development, [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground)
   works against a project's own client credentials.
3. `PUT /api/provider-tokens/google_photos_picker` with
   `{"access_token": "..."}`.

A plain Google OAuth access token is short-lived (about an hour) and the
in-process secret store (`app/secrets.py`) does not hold or use a refresh
token, so a session started after the token expires fails with `409` and
the owner has to repeat step 3 with a fresh token. GoPro Cloud import needs
the same per-provider `PUT` once GoPro's beta API access and
`TRAVEL_GOPRO_CLOUD_ENABLED` are both available — see GoPro's own beta
developer documentation for how that token is issued, which this project
does not control.

## Configuration and local checks

| Variable | Purpose |
|---|---|
| `TRAVEL_DATABASE_URL` | SQLAlchemy URL; PostgreSQL in production. |
| `TRAVEL_OIDC_ISSUER_URL` | Required issuer for production bearer-token validation. |
| `TRAVEL_OIDC_JWKS_URL` | Required JWKS endpoint for production bearer-token validation. |
| `TRAVEL_OIDC_AUDIENCE` | Expected API audience; defaults to `travel-api`. |
| `TRAVEL_SHARE_LINK_SECRET` | Keys the one-way verifier stored for each unlisted share-link token. Required in production; the code default is development-only. |
| `TRAVEL_MEDIA_STORAGE_ROOT` | Filesystem root for the local object-storage adapter; production points this at the backed-up VPS media volume, never Git. |
| `TRAVEL_MEDIA_MAX_UPLOAD_BYTES` | Refuses a direct upload or a single imported item larger than this (default 200 MiB). |
| `TRAVEL_GOPRO_CLOUD_ENABLED` | Enables the GoPro Cloud import adapter once beta API access is granted; `false` by default, and the product is fully usable without it. |
| `TRAVEL_GOOGLE_PHOTOS_PICKER_API_BASE`, `TRAVEL_GOPRO_CLOUD_API_BASE` | Provider API base URLs; overridable for testing against a sandbox. |
| `TRAVEL_OSM_PLACE_SEARCH_PROVIDER` | Registered owner-only place-search provider; defaults to `nominatim`. |
| `TRAVEL_OSM_PLACE_SEARCH_API_BASE`, `TRAVEL_OSM_PLACE_SEARCH_USER_AGENT` | Nominatim-compatible provider URL and required identifying user agent. |
| `TRAVEL_OSM_PLACE_SEARCH_TIMEOUT_SECONDS`, `TRAVEL_OSM_PLACE_SEARCH_CACHE_TTL_SECONDS`, `TRAVEL_OSM_PLACE_SEARCH_CACHE_MAX_ENTRIES` | Provider timeout and bounded in-memory confidential-query cache controls. |

Use a development subject header only with both
`TRAVEL_ENVIRONMENT=development` and
`TRAVEL_ALLOW_DEVELOPMENT_SUBJECT_HEADER=true`; it is rejected in production.

```bash
uv sync --all-groups --frozen
uv run ruff check .
uv run pytest
# Requires a PostgreSQL database, as the CI migration check does.
TRAVEL_DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/travel \
  uv run alembic upgrade head
TRAVEL_DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/travel \
  uv run alembic downgrade base
```

GitHub Actions runs these API checks, including the upgrade/downgrade cycle
against PostgreSQL, on changes to `api/` and on every push to `main`.
The initial migration can be reversed with `uv run alembic downgrade base`.
The central deployment in apps#215 must take a database backup before running
the first production upgrade. Its rollback is: stop `travel-api`, restore the
pre-upgrade database backup if it exists, or (only for a confirmed empty MVP
database) run `alembic downgrade base`, then deploy the previous API image.
