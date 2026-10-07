# Travel application backend

The backend exposes the Travel application through FastAPI and an
owner-authenticated MCP server. MCP tools use the application's typed owner
handlers and storage services; they do not read the static archive's JSON,
documents, or protected files directly.

## API contract

Application routes use the unversioned `/api` prefix. Owner routes require a
bearer token whose validated OpenID Connect `sub` matches the trip owner:

| Method | Route | Purpose |
|---|---|---|
| `GET`, `POST` | `/trips` | List the caller's trips or create a private trip. |
| `GET`, `PATCH`, `DELETE` | `/trips/{trip_id}` | Read, edit, or remove an owned trip. |
| `GET` | `/trips/{trip_id}/overview` | Owner-only review: counts per kind, visibility per kind, what the public page and each draft or active link receive, and warnings (an active audience receiving nothing, shared trip dates, planning words such as "concept" in a visible label, records without a map point because their area is not shared, undated visits duplicating dated ones). |
| `GET`, `POST` | `/trips/{trip_id}/visits` | List or add a visit (a stop): an area, or a location in one (`area_id` or `location`), with optional days (`starts_on`, `ends_on`), local times (`start_time`, `end_time`), kind (free or work), an owner-only `status` (`idea`, `planned` — the default — or `confirmed`; never shared, so planning state stays out of titles and area labels), private `notes` and a `summary` for visitors. Times stay private unless `share_time` is set, and are then shared only with full dates. |
| `GET`, `PATCH`, `DELETE` | `/trips/{trip_id}/visits/{visit_id}` | Read, edit, reorder (`position`) or remove a visit. |
| `POST` | `/trips/{trip_id}/travel-updates` | Add a reisupdate, the one record for something that happened. Its private part (`private_notes`, the `location`, attached `media_asset_ids`) is never shared; its shared part (title, `body`, date, area) reaches visitors only as its `visibility` allows: `private` (the default), `everyone` or `custom`. |
| `PATCH`, `DELETE` | `/trips/{trip_id}/travel-updates/{update_id}` | Edit or remove a reisupdate. Leaving `custom` or deleting it withdraws it from every live scope. |
| `PUT` | `/trips/{trip_id}/visibility/{kind}/{record_id}` | Choose `private`, `everyone` or `custom` for any shareable record (area or location, stage, route, stay, reisupdate, approved photo copy). The reason is returned when a record cannot be shared yet. |
| `PATCH` | `/trips/{trip_id}/locations/{location_id}` | Give a location its public name and area, and choose whether its address is shared; a location cannot be shared without a public name. Moving a location to another area moves the route ends and visits at it along. |
| `GET`, `POST` | `/trips/{trip_id}/areas` | List or save areas: cities and regions, private until shared. |
| `PATCH`, `DELETE` | `/trips/{trip_id}/areas/{area_id}` | Edit an area (for example its time zone) or remove one nothing uses. |
| `GET`, `POST` | `/trips/{trip_id}/routes` | List or add a route: how the trip gets from one area to another, by a travel mode (flight, train, bus, ferry, car, bike, walk or other). Only the mode and the two areas (`departure_area_id`, `arrival_area_id`, or an area implied by a `departure_location`/`arrival_location`) are required; exact locations, a schedule, carrier/booking details, attached documents and a drawn GeoJSON `geometry` are optional. The application takes no recorded GPS data. |
| `GET`, `PATCH`, `DELETE` | `/trips/{trip_id}/routes/{route_id}` | Read, edit or remove a route. |
| `GET`, `POST` | `/trips/{trip_id}/stays` | List or add an owner-only stay: its nights, city/area and, once chosen, the accommodation. |
| `GET`, `PATCH`, `DELETE` | `/trips/{trip_id}/stays/{stay_id}` | Read, edit or remove a stay. |
| `GET`, `POST` | `/trips/{trip_id}/trip-tasks` | List or add an owner-only booking/preparation task with optional HTTPS links. |
| `GET`, `PATCH`, `DELETE` | `/trips/{trip_id}/trip-tasks/{task_id}` | Read, complete/reopen, edit or remove a task. |
| `POST` | `/trips/{trip_id}/places/search` | Owner-only OSM search; returns attribution and a selected-result snapshot. |
| `POST` | `/trips/{trip_id}/places/reverse` | Owner-only, explicit coordinate-to-place suggestion; never writes a place. |
| `GET`, `POST` | `/trips/{trip_id}/locations` | List or save owner-only locations. |
| `GET` | `/trips/{trip_id}/locations/{location_id}/navigation` | Generate an owner-authorized exact Google Maps destination for a location. |
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
| `POST` | `/trips/{trip_id}/media/travel-update-candidates` | Calculate transient travel-update-review groups for media explicitly selected by the owner; never writes canonical data. |
| `GET`, `DELETE` | `/trips/{trip_id}/media/{media_id}` | Read or soft-delete a media asset. |
| `GET` | `/trips/{trip_id}/media/{media_id}/original` | Owner-only, `no-store` original file delivery. |
| `POST`, `GET` | `/trips/{trip_id}/media/{media_id}/derivatives` | Generate or list stripped/resized derivatives for share/static-export/owner-preview. |
| `DELETE` | `/trips/{trip_id}/media/{media_id}/derivatives/{derivative_id}` | Permanently remove a generated derivative and withdraw it from every live share scope. |
| `POST` | `/trips/{trip_id}/media/{media_id}/derivatives/{derivative_id}/approve` | Owner review sign-off; only an approved derivative may ever be referenced by a share scope. |
| `GET` | `/trips/{trip_id}/media/{media_id}/derivatives/{derivative_id}/file` | Owner-only, `no-store` derivative file delivery. |
| `POST`, `GET` | `/trips/{trip_id}/documents/uploads`, `/trips/{trip_id}/documents` | Upload and list owner-only trip documents. Documents have no share scope or visitor representation. |
| `GET`, `DELETE` | `/trips/{trip_id}/documents/{document_id}` | Read or permanently delete a trip document and its stored file. |
| `GET` | `/trips/{trip_id}/documents/{document_id}/original` | Owner-only, `no-store` original file delivery. |
| `POST`, `GET`, `DELETE` | `/library/documents...` | Manage owner-wide documents; deletion permanently removes the stored file. These files are never published. |
| `POST` | `/trips/{trip_id}/media/imports/{provider}/sessions` | Start a Google Photos Picker or GoPro Cloud selection session. |
| `POST` | `/trips/{trip_id}/media/imports/{provider}/sessions/{session_id}/complete` | Import every item the owner selected; safe to retry after a partial failure. |
| `GET` | `/provider-tokens` | Owner-only non-secret status. Google Photos is available only when OAuth credentials, redirect URI and encryption key are configured; GoPro Cloud remains unavailable pending its beta OAuth contract. |
| `POST` | `/provider-tokens/google_photos_picker/oauth/start`, `/provider-tokens/google_photos_picker/oauth/complete` | Start Google consent and exchange the returned code, with owner-bound one-time state and PKCE. |
| `PUT`, `DELETE` | `/provider-tokens/{provider}` | Legacy write-only manual access-token setup, or disconnect. Google OAuth disconnect also revokes its refresh token at Google. |

Trip tasks accept an optional `remind_at` timestamp. `due_date` only sorts
tasks. A scheduled worker creates owner-only inbox items at
`GET /trips/{trip_id}/task-alerts`; the owner can mark one read with
`PATCH /trips/{trip_id}/task-alerts/{alert_id}/read`. Run the worker with
`uv run python -m app.task_alerts` from `backend/`. It is safe to run repeatedly;
the VPS scheduler is tracked in [apps#230](https://github.com/tjorim/apps/issues/230).

The same worker sends each new inbox alert by email when SMTP and a recipient
are configured. Set `TRAVEL_TASK_ALERT_SMTP_HOST`,
`TRAVEL_TASK_ALERT_EMAIL_FROM`, and `TRAVEL_TASK_ALERT_RECIPIENTS` (a JSON
mapping from authenticated owner subject to email address). Optional settings
are `TRAVEL_TASK_ALERT_SMTP_PORT`, `TRAVEL_TASK_ALERT_SMTP_USERNAME`, and
`TRAVEL_TASK_ALERT_SMTP_PASSWORD`. STARTTLS is required. Email delivery is
recorded and retried up to five times; if SMTP succeeds but the database
commit fails, a retry may send a duplicate. No email is sent for an owner
without a configured address.

Travelers check ticket availability and make bookings themselves. A task
reminder never claims that tickets are available or makes a booking.
### Nights, local times and trip dates

A stay is the set of nights slept at one accommodation: `check_in_date` is
the first night and `check_out_date` the departure morning, so it covers
every night from check-in up to, but not including, check-out. Both dates and
the optional `check_in_time`/`check_out_time` are local to the stay. Every
stay has a `location` (filed under an area). While the accommodation is
still being chosen, send only `area_id`: every such stay in that area shares
one city-level location instead of each adding a copy, and `property_name`
stays empty. Setting `location` to `null` later returns a stay to it.

A route's day comes first: `departs_on` is the local departure day, in the
departure time zone, and can be set on its own ("on 5 December, no train yet").
A route's optional schedule is stored as UTC instants plus each end's IANA time
zone, and comes as a pair: both times or neither, and only with a day. With a
departure time, `departs_on` is derived from it (in the departure zone, else the
departure area's, else UTC) and a different day is refused; clearing the times
keeps the day. Send `departs_at`/`arrives_at` without an offset together with
`departure_timezone`/`arrival_timezone` to enter local wall-clock times such
as "AMS 10:40 → TPE 06:25 the next day"; a time with an explicit offset is
used as-is. Responses always carry the UTC offset.

An area (city or region) can carry an IANA `timezone`; edit it with
`PATCH /trips/{trip_id}/areas/{area_id}`. Stays inherit it through
their location's area, so the owner PWA can tell where the plan puts the owner
at any moment and show the live local time there, daylight saving included.
The zone is owner-only and never part of a shared projection.

A trip's `starts_on`/`ends_on` are owner-only local dates. A share scope can
include them with `trip.dates` set to `day`, `month` or `year`; the
projection then truncates both dates to that precision.

### Importing an archived trip

`app.archive_import` loads one trip extracted from the retired `dist/`
archive (#40), such as `dist/exampleland-2054/private/app-import.json`, through the
owner API. The trip and everything in it arrive private and unpublished; a
failed import deletes the partly created trip, and a second run with the same
title is refused unless `--allow-duplicate` is passed. To complete a trip that
already exists, `--trip-id TRIP_ID` adds only the records it does not have
yet (matched by area label, visit area/title/day, stay area/check-in, route
mode/areas, reisupdate title/date and task title); `--dry-run` with it reports
what is present and what would be created without writing anything.

```bash
# Local development API (the token the API runs with as TRAVEL_DEV_AUTH_BYPASS_TOKEN)
TRAVEL_API_TOKEN="$TRAVEL_DEV_AUTH_BYPASS_TOKEN" uv run python -m app.archive_import \
  ../dist/exampleland-2054/private/app-import.json --api-url http://localhost:8000/api
# Production: an owner access token, never committed
TRAVEL_API_TOKEN=... uv run python -m app.archive_import ../dist/exampleland-2054/private/app-import.json \
  --api-url https://travel.tjor.im/api
```

`tests/test_archive_import.py` imports the committed Taiwan file on every
backend run, so it stays valid against the current API.

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
stages and other items, and title/summary fields the owner selected; a reisupdate's own visibility decides who receives it). Both the scope
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
link, or its expiry (1-90 days, default 30; an owner can explicitly choose no
expiry), is enforced on every
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
owner-only location, including its canonical OSM URL, address, coordinates and viewport.
Existing OSM references receive their URL when the location migration runs.
Nominatim requests prefer English names for both search and reverse lookup;
when an English name is unavailable, Nominatim uses the available OSM name.
A reverse lookup is only a suggestion: it does not create or attach a place. It
is intended for an owner-confirmed media-EXIF suggestion flow (#52), never for
automatic capture or canonical writes.

A reisupdate can explicitly reference up to twelve owner-only `media_asset_ids`.
These attachments are private editing context, distinct from share
derivatives: they cannot be put in a public or unlisted scope. An owner
may use an attached photo's capture time as a date suggestion or send its GPS
to the explicit reverse endpoint, then choose a returned place before saving
the reisupdate. Neither action creates or changes a reisupdate or location
on its own.

`POST /trips/{trip_id}/media/travel-update-candidates` adds a separate review
step for a set of media the owner selected. It calculates, but does not
persist, candidate travel updates using a two-hour window anchored at each
group’s first capture time. GPS readings within 500 m share an explicit
option; readings outside that threshold remain separate choices, and media
with no capture time or GPS is omitted rather than guessed into a travel
update. The response is owner-only and cannot be referenced from a share
scope. Choosing a candidate can only prefill a local reisupdate draft or
explicitly attach the selected private media to an existing reisupdate.
Looking up its GPS still requires the owner to invoke the normal
reverse-geocode endpoint and select the result.

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
`navigation` markers. An area marker redirects to a textual city-level
target. A location marker exists only when a scope item explicitly grants
`{"kind":"location", "id":"…", "fields":["navigation"]}`; its
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
  requires a Google connection from **Instellingen**. Encrypted access and
  refresh tokens live in `provider_secrets` and are never returned by an API.
  Access tokens are refreshed before use, including during long imports.
- **GoPro Cloud import** uses the identical session/complete flow behind
  GoPro's beta OAuth setup; while that API contract is unavailable (the
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
response can pre-fill a reisupdate's date or suggest a place without any client
needing to parse the file itself — a provider's own capture-time metadata
(e.g. Google's `createTime`) is used only as a fallback when a photo has no
usable EXIF `DateTimeOriginal`. An EXIF time is the camera's wall clock and is
kept as written (`captured_local`), never converted to an instant; see
`docs/decisions/297-exif-capture-time.md`. This is a read, never a strip: nothing here
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

In a Google Cloud project, enable the Google Photos Picker API and register a
web OAuth client with `TRAVEL_GOOGLE_OAUTH_REDIRECT_URI` as an authorized
redirect URI. Set its client ID and secret in the server environment, plus a
Fernet key generated with `python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'`.
Keep that key outside Git and back it up with the database: losing it makes
existing connections unreadable. The redirect URI must be the public
`/admin/settings` page, for example `https://travel.example/admin/settings`.
The owner then selects **Verbinden met Google** in Instellingen. The server
requests only the Picker scope and offline access, and stores the returned
refresh token encrypted. Revocation calls Google's token endpoint before
removing the local credential; if Google cannot confirm it, the connection
remains visible so the owner can retry. The legacy manual `PUT` remains for
compatibility, but its access token has no refresh capability.

GoPro Cloud remains hidden until its beta OAuth/token contract is available;
`TRAVEL_GOPRO_CLOUD_ENABLED` alone does not expose it.
Production credential injection and key backup are tracked in
[tjorim/apps#240](https://github.com/tjorim/apps/issues/240).

## Configuration and local checks

| Variable | Purpose |
|---|---|
| `TRAVEL_DATABASE_URL` | SQLAlchemy URL; PostgreSQL in production. |
| `TRAVEL_OIDC_ISSUER_URL` | Required issuer for production bearer-token validation. |
| `TRAVEL_OIDC_JWKS_URL` | Required JWKS endpoint for production bearer-token validation. |
| `TRAVEL_OIDC_AUDIENCE` | Expected API audience; defaults to `travel-api`. |
| `TRAVEL_MCP_BASE_URL` | Canonical public MCP resource URL (for example `https://travel.example.test/mcp`); advertised as the protected resource and, by default, the only audience MCP accepts. Unset for local stdio use. |
| `TRAVEL_MCP_AUDIENCE` | Optional MCP audience when it must differ from the resource URL; never equal to `TRAVEL_OIDC_AUDIENCE`. |
| `TRAVEL_MCP_DEVELOPMENT_SUBJECT` | Local-test/stdio owner subject; honored only when `TRAVEL_ENVIRONMENT=development`, never in production. |
| `TRAVEL_PUBLIC_APP_URL` | Visitor-facing Travel PWA origin used by MCP to return a complete `/share/<capability>` URL; defaults to `http://localhost:5173` for local Vite development. Set this to the deployed Travel origin in production. |
| `TRAVEL_SHARE_LINK_SECRET` | Keys the one-way verifier stored for each unlisted share-link token. Required in production; the code default is development-only. |
| `TRAVEL_MEDIA_STORAGE_ROOT` | Filesystem root for the local object-storage adapter; production points this at the backed-up VPS media volume, never Git. |
| `TRAVEL_MEDIA_MAX_UPLOAD_BYTES` | Refuses a direct upload or a single imported item larger than this (default 200 MiB). |
| `TRAVEL_GOOGLE_OAUTH_CLIENT_ID`, `TRAVEL_GOOGLE_OAUTH_CLIENT_SECRET` | Google web OAuth credentials for Photos Picker. Both required for availability. |
| `TRAVEL_GOOGLE_OAUTH_REDIRECT_URI` | Public `/admin/settings` URI registered with Google. Required for availability. |
| `TRAVEL_PROVIDER_SECRET_KEY` | Fernet key encrypting owner credentials in PostgreSQL. Required for availability; back up securely. |
| `TRAVEL_GOPRO_CLOUD_ENABLED` | Legacy beta adapter switch; GoPro remains hidden until its OAuth contract is implemented. |
| `TRAVEL_GOOGLE_PHOTOS_PICKER_API_BASE`, `TRAVEL_GOPRO_CLOUD_API_BASE` | Provider API base URLs; overridable for testing against a sandbox. |
| `TRAVEL_OSM_PLACE_SEARCH_PROVIDER` | Registered owner-only place-search provider; defaults to `nominatim`. |
| `TRAVEL_OSM_PLACE_SEARCH_API_BASE`, `TRAVEL_OSM_PLACE_SEARCH_USER_AGENT` | Nominatim-compatible provider URL and required identifying user agent. |
| `TRAVEL_OSM_PLACE_SEARCH_TIMEOUT_SECONDS`, `TRAVEL_OSM_PLACE_SEARCH_CACHE_TTL_SECONDS`, `TRAVEL_OSM_PLACE_SEARCH_CACHE_MAX_ENTRIES` | Provider timeout and bounded in-memory confidential-query cache controls. |

`TRAVEL_DEV_AUTH_BYPASS_TOKEN` is a local-development shortcut that skips OIDC
verification: a request whose bearer token equals it acts as the fixed
`dev-bypass-user` owner. Startup refuses it unless
`TRAVEL_ENVIRONMENT=development`. It is the same contract as champagnefestival's
and worktime's `DEV_AUTH_BYPASS_TOKEN`.

### Owner MCP server

Local stdio is deliberately development-only: set a development subject for
an integration test or local owner workflow:

```bash
TRAVEL_ENVIRONMENT=development TRAVEL_MCP_DEVELOPMENT_SUBJECT=owner-local \
  uv run python -m app.mcp_server
```

The server exposes task-specific tools for all owner resources, including
private media imports and derivatives, owner-only document uploads, previews, publication and
share-link lifecycle. `get_trip_overview` checks a trip in one read (the
`/overview` route above), `batch_create` adds many visits, stays, routes,
reisupdates and tasks all-or-nothing, and `list_areas`, `list_locations`,
`list_visits`, `list_stays` and `list_routes` return compact rows (ids and
labels) unless `compact=false`; `list_areas` also takes a `query` to find an
area by name. Audience changes, capability activation/rotation and
deletion require `confirm=true`; a raw share capability is returned only by
activation or rotation, together with its complete visitor `share_url`, and is
never stored in the MCP audit table.

Clients list only `whoami`, `list_trips`, `get_trip_overview`,
`search_tools` and `call_tool`. `search_tools(query)` ranks the full catalogue
with BM25 over tool names and descriptions (English or Dutch owner vocabulary,
such as "merge duplicate locations" or "verblijf toevoegen") and returns up to
five tools, each with its `input_schema`, `effect` and `requires_confirmation`;
`call_tool(name, arguments)` runs one with the same validation, audit and
confirmation rules as a direct call, and the audit row names the inner action.
Search depends on the docstrings, so a new tool's description should name the
task it serves; the tests check a table of real phrasings and that every tool
is found by its own name. See
[`docs/decisions/196-layered-mcp-tool-discovery.md`](../docs/decisions/196-layered-mcp-tool-discovery.md).
`/api/mcp/capabilities` lists the full catalogue and the listed surface as
`visible_tools`.

The local
MCP server is mounted by FastAPI at `/mcp` only when both
`TRAVEL_MCP_BASE_URL` and `TRAVEL_OIDC_ISSUER_URL` are configured. It accepts
only Keycloak tokens whose audience is the MCP resource, never the API token;
see [`docs/decisions/336-mcp-resource-audience.md`](../docs/decisions/336-mcp-resource-audience.md)
for the contract and reconnect steps. Caddy routing, production Keycloak
configuration and endpoint exposure remain `tjorim/apps#226` and
`tjorim/apps#265` work.

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
against PostgreSQL, on changes to `backend/` and on every push to `main`.
The initial migration can be reversed with `uv run alembic downgrade base`.
The central upgrade (`scripts/upgrade-apps.sh travel` in the `apps`
repository) runs `alembic upgrade head` without a separate pre-migration dump;
the latest encrypted Restic snapshot covers the database and media together
(apps#220). Rollback is: stop `travel-api`, restore the database and media from
that snapshot using the `apps` recovery guide, then deploy the previous API
image. Never run `alembic downgrade base` against a database with content.
