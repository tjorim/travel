# Changelog

All notable changes to the travel hub are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and releases use CalVer
(`YYYY.M.MICRO`). `VERSION` is the single source of truth: `node scripts/release.mjs bump` writes it
everywhere and turns `[Unreleased]` into the next release, and `node scripts/release.mjs check` (run by CI
and before a release tag) verifies the two agree. The 2026.11.1 release summarizes the accumulated
pre-release history, preserved in `docs/history/2026.11.1-development.md`. Group new entries under `### Added`, `### Changed`, `### Fixed` or `### Removed`.

Entries under `### Internal` (backend, infrastructure, CI, dependencies) are left out of what the apps
show their users. Start a bullet with a scope such as `**Web:**` to limit it to one client or area; the
allowed scopes are listed in `release.config.json`, and `check` validates `[Unreleased]`.

## [Unreleased]

### Changed

- A travel update's own cap on its shared date is now `share_date_precision`, the name a visit and a stay already use, in the owner API (`POST` and `PATCH /api/trips/{id}/travel-updates`, and every response that returns an update), the MCP tools and the trip export (`travel_updates[].share_date_precision`, part of `travel/trip-export@2`). The visitor document keeps `date_precision` for the delivered value. A write that still sends `date_precision` is read as `share_date_precision` for one release; a request that sends both with different values is refused (#386).
- `occurred_at` of a travel update may be sent as a wall-clock time without an offset (`2054-11-20T07:00`): the server reads it in the update's own zone, so the time typed at a place is the time stored for it. An instant with an offset is kept as written. Update responses carry `timezone` (the zone the update's day is read in) and `local_date` (its day), and the export carries `travel_updates[].timezone` beside `local_date` (#391).
- **Web:** The travel update and capture forms read and write the time at the place (the area's zone, else the trip's nearest stay or visit) instead of the browser's zone, say which zone that is, and the owner's lists show the same day a visitor is given, whatever zone the browser is in (#391).
- `GET /api/trips` and the MCP `list_trips` tool return each trip as a summary (title, dates, cover, and how many travel updates it has with the time of the newest) instead of the whole trip with every update embedded. The list is newest first and holds at most 100 trips (`limit` defaults to 100); read a trip's updates from `GET /api/trips/{id}/travel-updates` (#365).
- `GET`, `POST` and `PATCH /api/trips/{id}` and the MCP `get_trip`, `create_trip` and `update_trip` return the trip's own fields and cover without its `travel_updates`; read them from `GET /api/trips/{id}/travel-updates` or the new MCP tool `list_travel_updates`. That list is now chronological, oldest first, like every other dated record (it answered newest first), and `?latest=N` returns only the newest N (#365).
- **Web:** A stay, a visit and a route with the same planning status now carry the same label in the owner lists, agenda and dialogs; a planned stay no longer reads "Suggested" or "Still to choose". A stay still being considered without a linked location says "Location not linked yet", and a confirmed stay no longer does.
- **Web:** Visitors see a place's country by name in their language (for example "Taipei · Taiwan") instead of the two-letter code.
- **Web:** A visitor's live location now says how long ago it was observed ("12 minutes ago") instead of an absolute time in the visitor's own zone, and keeps counting up while the page stays open; the full time with its zone is the hover title. The owner's live-location panel and track list show the time with its zone abbreviation.

- **Web:** Visits are ordered by day, then time, then creation, like stays and routes, with undated visits last in creation order, so the Visits list, the agenda and the visitor plan show them in the same order. The Move up and Move down buttons are gone (#367).

- **Web:** The notes under uploads now say your files stay in your private Travel app instead of "your private tracker".
- A share link, public page and collection member always report their scope with `schema_version`, `trip` and `items`, even when the stored scope held only some of them (the response used to repeat the stored document as it was).

### Fixed

- A travel update without an area, or whose area has no time zone, is no longer dated by the UTC day of its instant: it reads the zone of the trip's stay or visit nearest its day (one that covers it wins, then the closest; UTC only when the trip has no zoned stay or visit at all), so the visitor story, the `days` number, "N days later", the PDF, the export and the owner's lists show the same day. Editing the dates or area of a stay or visit can move such an update's day (#391).
- Entering a travel update for an area in another time zone than the browser's no longer stores an instant that differs from the wall-clock time typed there, and opening it again shows the time typed (#391).
- A travel update is now dated by the calendar day of its area's time zone instead of the UTC day of its instant, so an update written at 07:00 in Taipei is shown on that day to visitors (and in the days figure, "N days later", the PDF and the export's `local_date`) instead of the day before, and the owner's lists read the same day. An area without a time zone keeps the UTC day; changing an area's time zone moves the day of its updates (#357).
- **Web:** Counts of days until departure, overdue tasks, route points, photos and intentional delay minutes now read "1 day", "1 overdue task", "1 point", "1 photo/media" and "1 minute" in both languages instead of a plural noun.

### Removed

- Remove the visit `position`: `POST` and `PATCH /api/trips/{id}/visits` no longer accept it (a request that sends it is refused with `422`), visit responses and the MCP visit rows no longer carry it, and the `409 conflicting_visit_position` error is gone. Visits are listed by day, then time, then creation, undated last; the trip export no longer has `visits[].position`, so its schema is now `travel/trip-export@2` (#367).
- Remove the manual provider token endpoint `PUT /api/provider-tokens/{provider}`; Google Photos connects only through the OAuth routes, and `DELETE` still disconnects (#359).
- Stop accepting `booked` as a stay or route status; it was folded into `confirmed` by migration 010 and no client sends it (#359).
- Remove the unused "static archive" copy purpose: a leftover static-export copy becomes a private preview (#359).

### Internal

- The frontend API types are generated by Orval (schemas only, one file per schema in `frontend/src/api-schema/`) instead of `openapi-typescript`, which needs the TypeScript 5 compiler API that TypeScript 7 no longer ships. `frontend/.pnpmfile.cjs`, which worked around that and made every Renovate lockfile update fail `pnpm install --frozen-lockfile`, is gone (#422).
- Sharing audit events now survive the deletion of their trip until their 24-month expiry, like collection and owner activity events (the `audit_events.trip_id` foreign key with `ON DELETE CASCADE` is gone). They keep ids only, and deleting a trip removes the owner-entered link labels and reasons from them. Decision 36 states what happens to each audit record when a trip or collection is deleted (#364).
- `mcp_audit_events` is now `owner_activity_events` (model `OwnerActivityEvent`) with an explicit `transport` column (`mcp` or `http`) in place of `details.transport`. The audit event kinds of all three audit tables are plain strings checked against a code list when a row is written, so a new kind needs no migration (migration 031; the PostgreSQL enums `travel_audit_event_kind` and `travel_audit_target_type` are dropped). The sharing preset audit kind `audience.preset_apply` is now `public_projection.preset_apply` or `share_link.preset_apply` in `GET /api/trips/{id}/audit-events`, and **Web:** the sharing history names a preset apply (#364).
- The MCP HTTP endpoint now accepts request bodies up to 48 MiB instead of the MCP SDK's 4 MiB default, so a base64 upload over MCP holds about 36 MiB of file (phone photos, scanned PDFs, short clips) instead of about 3 MiB. FastMCP does not expose the SDK's `max_request_body_size`, so `TravelStreamableHTTPSessionManager` reapplies one shared constant (`MCP_MAX_REQUEST_BODY_BYTES`) to the SDK's limit, and the same constant sets the `413` `mcp_request_too_large` refusal that names the multipart upload API, issued before the request is throttled, authenticated or read. Tests accept a body of exactly the limit and refuse one byte more through the production mount, so an upgrade that stops honouring the override fails loudly; a uvicorn measurement shows a request at the limit costs about 3.1 times its body in peak memory (148 MiB, 445 MiB for three at once), and a fresh-process measurement of a 150 MiB stdio upload bounds decoding and storage to a few chunks beyond the encoded JSON. Files above the limit still need the multipart API or the bounded upload handle, which stays open in #84.
- **Web:** Rename the 964 `owner_*` interface messages by area (`trips_`, `stays_`, `routes_`, `visits_`, `areas_`, `locations_`, `updates_`, `tasks_`, `capture_`, `map_`, `merge_`, `alternatives_`, `records_`, `common_` and others) and retire the prefix: `owner_` joins `assets_` in `retiredKeyPrefixes`. The 168 keys that were the English sentence and the 44 numeric suffixes (`owner_close_2`) now say where and why they are used, the 149 positional `{p0}`/`{p1}` parameters carry what they hold (`{name}`, `{count}`, `{title}`), and the 31 duplicates that were identical in both languages are merged; no message text changed (#371).
- **Web:** Replace the last sentence fragments (`Library ·`, `· captured`, `· Read`, `· New`, `· on`, the task reminder and checked-off suffixes) with whole messages, so `fragmentMessages` in `scripts/locale-audit-exclusions.mjs` is empty (#371).
- The PDF label tables and the Home Assistant translations are now checked for the same keys and placeholders in every language by `backend/tests/test_label_parity.py` (#371).
- **Web:** Rename the 531 `assets_*` interface messages (`frontend/messages/*.json`) after the area that shows them (`packing_`, `media_`, `publication_`, `sharing_`, `library_`, `offline_`, `common_`) and merge `assets_link_copied` into its identical `sharing_link_copied` (#371). `pnpm locale:audit` now fails a key that starts with a retired prefix (`retiredKeyPrefixes` in `scripts/locale-audit-exclusions.mjs`), so `assets_` cannot return.
- Migration 030 renames `travel_updates.date_precision` to `share_date_precision` (the shared `travel_date_precision` type stays; the downgrade renames it back). A PostgreSQL test checks both directions (#386).
- `app/update_day.py` derives an update's zone (its area's, else the nearest dated stay or visit, else UTC) and `app/update_zones.py` reads a trip's zoned stay and visit days for the surfaces that do not load the whole trip; the projection, the PDF, the export and the update services all use them (#391).
- Start moving domain logic out of the HTTP routers into `backend/app/services/` (#369): visits, stays, routes, travel updates, tasks, the trip ownership check (`owned_trip`), place resolution and visibility choice (`choose_visibility`, `make_private`) are services that take a session, the subject and typed input, never commit, and raise `Refusal`, a `ServiceError` for what the caller sent (`RecordNotFound` for a missing record, answered with 404). The application turns a `Refusal` into the same body an `ApiException` gave, so no response changes. Each router handler and each MCP tool owns its transaction, one commit per request and one per call or batch, so `batch_create` no longer replaces `session.commit` with `flush`. The MCP tools for those features call the services instead of router functions and take their ids as the same `Identifier` type as the HTTP paths, so a malformed id fails with the same code on both transports; a stay that checks out before it checks in is refused by `StayCreate` itself. Routers no longer import each other: the shared sharing, delivery, collection-index and live-location helpers moved to `services/sharing.py`, `services/delivery.py` and `services/live_location.py`, and a test fails if a router or a service imports a router.
- Continue moving domain logic out of the HTTP routers into `backend/app/services/` (#369): trips (list, create, get, overview, update, delete), areas (including suggestion and merge), locations (including update, navigation and merge), place search, packing (lists, bags, items, templates), alternative groups, trip documents and the owner library with its emergency information are services that take a session, the subject and typed input and raise `Refusal`. A 409 is a `Conflict`, and a refusal can carry a structured `detail`, so the merge widening and stale-choice reviews and the location visitor-change review no longer need an `ApiException`; the MCP tools send that detail as JSON text, as before. The routers and the MCP tools own the commit (an upload or removal of a document original still commits inside its storage service, as `docs/object-storage.md` requires). A place provider failure is answered by one application handler (status and `Retry-After`) whichever route searched. The MCP tools for those features call the services, so `list_areas` filters with the HTTP `q` search (accent-insensitive), `batch_create_packing_items` and the packing, alternative and library tools fail with the same code as their HTTP routes, and `undo_alternative_choice` takes `event_id` as an `Identifier`. `test_service_transports.py` now lists which router each MCP module may still import (publication, collections, media, precision and sharing presets, for the next slice).
- Finish moving domain logic out of the HTTP routers (#369): publication (the public page, named share links, previews, the feed capability), collections, sharing presets, the date-precision bulk choice and media (uploads, derivatives, provider imports and thumbnails) are services in `backend/app/services/` that never commit, and the MCP tools call them instead of router functions. `services/sharing.py` and `services/delivery.py` no longer raise `ApiException`: a lost revision race is `RevisionConflict` (412, carrying the current record), a malformed `If-Match` is `InvalidRevision` (400), a provider failure is `BadGateway` (502), and a lazy link or collection expiry is recorded in the caller's transaction (the router commits it) instead of committing inside `expire_collection`. The privacy headers and `Response` shaping of anonymous and preview delivery moved to `app/http_delivery.py`, which only routers import. The object-storage lifecycle (`docs/object-storage.md`) is split around the caller's commit instead of committing inside `document/service.py`, `library/service.py` and `media/service.py`: an upload writes and verifies its bytes and flushes the row, the transport commits; a removal marks the object `purge_pending` and returns a `PendingPurge`, and the transport commits and then finalises it (HTTP routers directly, the MCP tools through `_call(after_commit=...)`); completing a provider import takes the transport's commit as a `checkpoint`, so each fetched item is still durable at once. No module outside `routers/` imports a router except `main.py`, and a test fails for a service that calls `commit`.
- Split `backend/app/mcp_server.py` into the `backend/app/mcp_server/` package, one module per tool family (trips, itinerary, places, sharing, collections, media, documents, packing, tasks, alternatives, identity) over a shared `core` (identity, the transaction and audit of one call) and `rendering`, with `server` holding registration, failure reporting, the capability manifest and the HTTP app. Tool names, schemas and behaviour are unchanged; `python -m app.mcp_server` still runs the stdio server.
- The frontend API types are generated from the backend's OpenAPI document (#362): `frontend/openapi.json` is a committed snapshot written by `python -m app.openapi_export`, `frontend/src/api-schema.ts` is generated from it by `pnpm api:generate` with a pinned `openapi-typescript`, and `pnpm typecheck` (so CI) fails when the generated file is stale, as does the backend test when the snapshot is. `frontend/src/tracker-model.ts` and `projection-types.ts` are gone: records are named in `api-types.ts`, and their helpers live in `records.ts`, `dates.ts`, `whereabouts.ts` and `files.ts`.
- Every JSON endpoint now has a `response_model` (the live-location, packing suggestion and source, Google OAuth start, identity, health and MCP capability endpoints were bare dicts), a share scope and an audit event's details are typed instead of `dict`, and response models derive from `ResponseModel` so the schema lists a field that is always sent as required. A test fails for a new endpoint that answers with an anonymous object.
- `python-travel`'s hand-written wire models cannot be generated (the package is published on its own); `backend/tests/test_python_client_models.py` instead checks each against the OpenAPI schema.
- Rename the leftover "tracker" naming outside decision records: the API title and module docstrings, `OwnerSession`, `buildOwnerRouteTree` and `createOwnerRouter`. The `travel-tracker` OIDC client id and the `travel-tracker-*` browser storage keys stay, because renaming them would sign every owner out and needs the Keycloak client changed in `tjorim/apps`.
- Migration 029 drops `visits.position` and its unique `(trip_id, position)` constraint, along with the renumbering, move and compaction code; where visits already tied on `created_at` (every row converted by migration 001) it keeps their old order by nudging the ties apart by microseconds, and the downgrade restores a position from the new order. One `VISIT_ORDER` (with `visit_order_key` for records in memory) orders the trip's visits, the visit list, the export and the visitor projection, and a new visit is stamped with a sub-second `created_at` so visits created in one batch keep their order (#367).
- Type the visitor document end to end (#361): every delivered kind (visits, places, updates, stays, media, routes, navigation, dates) is now a Pydantic `Projection*` model whose fields are the allowlist, built by the renderers and published in the OpenAPI schema, and a field a renderer adds without declaring it is refused. The delivered JSON is unchanged. A route map point without a label is left out instead of being given the Dutch placeholder "Vervoerspunt" (a shared location always has a label). **Web:** `ProjectionView`, the day plan and the update context read typed records from `src/projection-types.ts` instead of `unknown` fields.
- Merge the `StayStatus`, `RouteStatus` and `VisitStatus` enums into one `PlanningStatus`, and the three PostgreSQL types into `travel_planning_status` (migration 028, which converts every column without changing a value); the frontend keeps one `PlanningStatus` type and one label table. The API values (`idea`, `planned`, `confirmed`, `cancelled`) are unchanged (#359).
- Owner requests no longer load the whole trip graph to check ownership: `owned_trip` reads only the trip row unless a handler asks for the relations (projection, overview, sharing, merge, alternatives, the trip response). Tasks, stays, routes, visits and travel updates read the one record they need, so a task or packing change costs the same few queries in a trip of any size (asserted in `tests/test_query_budget.py`). Stays, routes, visits and tasks now share one ordering rule between the trip and their own list endpoints (part of #365).
- **Web:** The owner's trip list reads summaries; a trip's workspace, the capture dialog and the sharing pickers read its travel updates from their own query, and the owner home reads the three newest per trip with `?latest=3` (#365).
- One server-side order per record kind: `TRAVEL_UPDATE_ORDER` (with `travel_update_order_key`) now orders the `Trip.travel_updates` collection, the list endpoint, the export, the PDF and the visitor projection, and the PWA no longer reverses the list it reads. `GET /api/trips/{id}` and trip writes read the trip row and its cover only, and a trip's reads and writes cost the same few queries whatever it holds (asserted in `tests/test_query_budget.py`, #365).
- **Web:** Remove 30 interface messages no source referenced, and make `pnpm locale:audit` fail on an unused message key and on a one-word connective or joined sentence fragment (part of #371). The few fragments still in use, and any computed message lookup, are listed with reasons in `scripts/locale-audit-exclusions.mjs`.
- Migration 027 makes `MediaDerivative.processing_backend` and the task alert `kind` PostgreSQL enums and drops `static_export` from the derivative purpose type. `MediaWorkerJob.state` and `McpAuditEvent.result` stay free strings: the first echoes the remote worker's states, the second already mixes `success` and `succeeded` (#359).
- Lint the Home Assistant integration and both Python packages with the same ruff rule set as the backend (`E, F, I, UP, B, C4, SIM`); two `lambda` assignments and one `try`/`except`/`pass` were rewritten to satisfy it.
- Check the formatting of workflows, scripts and the root JSON files in CI (`pnpm format:repo:check`), and use the same frontend script names as the other apps (`typecheck` replaces `check`; `lint` and `format` cover the whole frontend).
- Align the release workflow with the shared job graph used by every app: `validate`, `library-checks`, `publish-library`, `package-hacs`, `draft`. The HACS archive is built and checked in its own job, and the library tests run before the PyPI approval instead of after it.
- Reduce `PLAN.md` to the open, ordered issues (adding the clean-up group #357-#376), fix four model docstrings that described an earlier state, tidy `docs/domain-model.md` and `AGENTS.md`, and drop the stale mapped-field inventory in favour of `models.py`.
- Record the convention for dates, times and record names in `docs/domain-model.md` (inclusive `starts_on`/`ends_on`, wall clock plus the area's zone, `title`/`label`/`name`), with the documented exceptions, and open #386 for the one rename it chooses (#358).

## [2026.11.2] - 2026-11-10

### Internal

- Publish `python-travel` to PyPI with the app's CalVer from `release.yml` (trusted publishing, environment `pypi`) and pin it by version in the Home Assistant manifest instead of a source-archive URL; `release.mjs` keeps its version, lockfiles and the pin in step with `VERSION`.
- Report the built source commit alongside the app version in the health response; VPS builds receive the full commit from the shared deployment tooling (tjorim/apps#345).
- Build, validate and attach the HACS archive to tag-triggered draft releases; retain manual testing before publication (#350).
- Consolidate the accumulated 2026.11.1 release notes into categorized, scoped summaries and preserve the original development history separately (#349).

## [2026.11.1] - 2026-11-10

This first CalVer release consolidates the application's accumulated development history.
The [full development history](https://github.com/tjorim/travel/blob/v2026.11.1/docs/history/2026.11.1-development.md)
preserves the original entries, including superseded work and detailed validation limits.

### Added

- **Web:** Plan trips with areas, saved locations, visits, stays, routes, tasks and packing lists. Keep ideas and alternatives alongside confirmed plans, choose an alternative, and attach private booking documents to stays and routes (#238, #239, #257).
- **Web:** Capture travel updates with photos and Markdown, review private media, and manage trip documents, an owner-wide document library and emergency information.
- **Web:** Explore trips through an agenda, searchable workspace and interactive maps. Create visits, stays and routes from a day or map point, draw approximate routes, suggest flight lines locally, and review imported route drafts before saving (#240, #242, #243).
- Share selected stories and plans through public trips, revocable hidden links and multi-trip collection links. Each audience has its own selected records, exclusions and date precision; private notes, booking details and documents remain owner-only (#136, #237).
- **Web:** Review sharing with Story only, Story and route or Planned trip presets, per-audience previews, exception lists and warnings before widening access or publishing future plans (#231, #241).
- **Web:** Read public and hidden-link trips with photo galleries, story-following maps, day plans where shared precision permits, optional visitor numbers, printable layouts and public trip link previews (#230, #245, #246).
- **Web:** Save selected private content in encrypted device-scoped offline copies, and explicitly refresh or remove it. Visitor hidden links have a visible saved-on-this-browser notice and a Forget control.
- **Web:** Use Dutch or English, light or dark appearance, keyboard-accessible record dialogs and compact phone navigation. Authored trip content is translated only through an explicit private draft action.
- **Web:** Download private trip JSON exports or bounded story/itinerary PDFs using either saved audience selections or acknowledged private output. PDFs include headings, bookmarks and approved-photo alternatives; full PDF accessibility acceptance remains pending (#248, #321).
- Follow text-only public Atom feeds or separately enabled, expiring and revocable hidden-link feeds (#247).
- **Home Assistant:** Manage trip tasks and packing through native to-do entities, with explicit trip selection and refresh after confirmed writes (#319).
- Optionally forward selected Home Assistant locations to disabled-by-default Travel sources. Exact tracks remain owner-only until explicit deletion; each enabled public or hidden-link audience receives only its latest eligible point at the selected precision and delay. Source inactivity hides delivery after 24 hours. Locations and tracks are excluded from PDF, Atom and ordinary trip exports (#244, #332).

### Changed

- **Web:** Organize the owner workspace around a desktop sidebar, phone section drawer, persistent record details and photo-first Capture. Preserve editor drafts, guarded dismissal and focus return across navigation and resizing.
- **Web:** Lead visitor stories with approved photos and covers, group shared context by area and day, and offer Story / Map / Plan views on narrow screens.
- Apply audience date precision to route departure days as well as visits and stays. Month- or year-only audiences no longer receive exact route times; review existing audiences before relying on a shared day or time (#262).
- **Home Assistant:** Discover sign-in configuration from Travel instead of asking for application credentials. Production Keycloak provisioning and end-to-end OAuth verification remain tracked in [tjorim/apps#333](https://github.com/tjorim/apps/issues/333); deployment is not claimed complete.
- License Travel, the Python client and the Home Assistant integration under Apache License 2.0.

### Fixed

- **Web:** Repair inaccessible names, heading levels, gallery navigation and focus handling; improve narrow layouts, zoom behaviour, contrast and reduced-motion map behaviour.
- **Web:** Preserve open editors through session renewal, isolate Capture drafts by owner and trip, and show translated validation and upload failures in the active dialog.
- Preserve route time-zone offsets in visitor projections and keep sharing previews aligned with delivered fields and precision.

### Removed

- Retire the static archive authoring workflow and legacy session gate in favour of application-managed content and authenticated owner workflows. Existing historical entries do not authorize automatic archive migration.

### Internal

- Provide owner-authenticated FastAPI and MCP operations with shared validation, ownership enforcement, bounded discovery and payload-free audit/error references; add the separately installable async Python client (#318).
- Harden object storage, upload validation, private file responses, anonymous delivery, authentication, rate limits, deletion and audit retention. Keep object deletion behind committed purge inventory and locking.
- Update backend/frontend dependencies and tooling, adopt owned Base UI/shadcn controls and Tailwind tokens, and add synthetic API, migration, accessibility, browser and bundle-budget checks. Remove scheduled Dependabot PR configuration.
- Standardize CalVer release metadata, changelog filtering and reproducible Home Assistant ZIP packaging. HACS download/update verification and full PDF accessibility acceptance retain the limits recorded in the development history (#329, #321).

## [0.2.0] - 2026-11-09

First HACS release of the separately versioned Travel integration. Requires Home Assistant 2026.10.4+ and Python >=3.14.2. Add `tjorim/travel` as a custom Integration repository in HACS and install this release, then restart Home Assistant.

### Added

- Native owner-only trip task and packing to-do entities, explicit trip selection, OAuth application credentials, refresh after confirmed writes, and safe diagnostics/errors.
- Optional live location forwarding, off by default, from explicitly selected HA entities to owner-configured Travel sources. No history queue or write retries. Travel retains exact private tracks until explicit deletion.
- Audience sharing is configured separately in Travel: review each public/hidden-link audience's precision, delay and actual delivered point. Only the latest eligible point is delivered, never a visitor track. Delays are zero, 15/30 minutes, 1/2/24 hours; source inactivity hides delivery at 24 hours. Stopping preserves private tracks; deleting clears current delivery. Locations/tracks stay out of PDF, Atom and ordinary trip exports.
- Reproducible `travel.zip`, local Travel icon, and immutable HTTPS python-travel 0.2.0 source dependency; no Git executable or public PyPI publication required. HA needs outbound GitHub/package-index access.

Production unattended OAuth is **not verified or claimed deployed**. Dedicated Keycloak client provisioning and end-to-end login/refresh/revocation verification remain tracked in [tjorim/apps#333](https://github.com/tjorim/apps/issues/333).

Tasks, packing content, entity names, OAuth credentials and locations are private. Restrict HA users, dashboards, recorder/history/logbook and encrypted backups; recorder exclusion does not erase old history or protect config-entry backups. HA and Travel backups can retain deleted data until their separate retention expires. Review the [installation/privacy guide](https://github.com/tjorim/travel/blob/v0.2.0/home-assistant/README.md) and [location decision](https://github.com/tjorim/travel/blob/v0.2.0/docs/decisions/244-live-location-tracks.md) before enabling forwarding or sharing.

## 2026-09-21

### Added

- Static Exampleland 2054 public overview and protected detailed itinerary.
- Travel-hub landing page structured for future trips.
- Shared protected `/private/` area for general travel documents and emergency
  information.
- Git-backed document manifest and in-app native document preview component.
- Reusable international flight-map component with Taiwan AMS ↔ TPE flight data.
- Reusable travel-component directory at static archive.
- Public/private trip-data planning and implementation backlog.

### Changed

- Renamed the repository and apps submodule from `exampleland-2054` to `travel`.
- Expanded Caddy protection from only trip-private pages to both `/private/`
  and every `/<trip>/private/` route.
- Deployed `travel.tjor.im`; its public route is live and private routes are
  protected by the VPS-managed credential.
  ([#5](https://github.com/tjorim/travel-private/issues/5))

[Unreleased]: https://github.com/tjorim/travel/compare/v2026.11.2...HEAD
[2026.11.2]: https://github.com/tjorim/travel/compare/v2026.11.1...v2026.11.2
[2026.11.1]: https://github.com/tjorim/travel/compare/v0.2.0...v2026.11.1
[0.2.0]: https://github.com/tjorim/travel/releases/tag/v0.2.0
