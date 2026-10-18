# Travel plan

This is the working order for Travel. It is evolving from a Git-backed archive
with a small tracker into a private, privacy-gradient travel journal: a custom
Polarsteps-style application for active trips and deliberately published live
trip views. The React frontend and API are deployed through the central VPS
infrastructure.

The `Now`, `Next` and `Later` sections mirror the open GitHub issues in their
working order. When an issue is closed, move it to `Recently completed` and
record the delivered change in `CHANGELOG.md`.

## Product direction

The Travel app will become the source of truth for its trips, private assets
and sharing rules. No new app content belongs in Git. The existing `dist/`
archive remains in the repository, offline after launch, until #40 handles it.

The Travel application is the live, server-filtered destination for deliberately
published public and unlisted trip views. Its frontend code is deployed from
the application, but no generated trip-page artifact or user trip content is
published from Git. A live trip view is not a backup and not an automatic record
of every private item. Publication from the app must be an explicit action.
The app launches with new application data. Existing Git-backed archive
content is not imported, published or kept as a URL compatibility layer. The
old static trip is unavailable at launch.

## Data and access boundary

Public routes contain the story of a trip: intentionally selected photos,
reisupdates, visits, routes, areas and locations.

The app is private by default. The account owner is the only person who can
sign in, create or edit data. There are no viewer accounts or sharing groups.
For each private-by-default trip, the owner can select its public follower
view and/or create custom revocable high-entropy unlisted links with deliberately
selected scopes. A custom link can show more or different detail than the
public view. An unlisted link is a forwardable capability rather than proof of
a recipient's identity. The backend produces the matching redacted response and
must not send data to a client merely to hide it in the UI.

Exact coordinates, addresses, booking references, documents, unredacted media
metadata, precise schedules and private journal entries are sensitive by
default. A shared area, route or selected location is delivered through a fixed
allowlist, never a client-side mask of an exact record.

Locations with an address, stays, media uploads and device-scoped offline copies
are in scope. They remain owner-only until shared deliberately. The product
stores no recorded GPS data, live or finished: how the owner travels is an
approximate route drawn by hand, with a travel mode, and no exact or
near-real-time location is published automatically.

All canonical files live on the backed-up VPS in application-controlled object
storage; the database holds their metadata and access policy. Media may enter
through direct device upload, an owner-authorized Google Photos Picker import,
or a GoPro Cloud import if its beta API access is available. Imported media is
copied to VPS storage; third-party URLs are never the canonical file or a
viewer-facing privacy boundary.

External map or navigation links are also sensitive: only an authorized viewer
may receive an exact OSM reference, Google Maps destination or precise map
viewport. A Google Maps navigation link is generated on demand after access
control, while less-authorized viewers receive at most a city-level link.

## Delivery backlog

Each open delivery issue has one checkbox. The change that closes an issue must
tick its checkbox and move its delivered result to `Recently completed`; both
take effect when that change is merged.

v1 is application-only work. It uses local/test storage and test deployments
as needed, but does not change shared VPS routing, production media storage,
or backup automation. Those operational changes begin only in v2 after the
app behavior is complete and verified.
The app also needs the archive's useful trip workflows and presentation before
the v2 cutover. These are application features, independent of the optional
archive-content import in #40.

### v1 — Private travel journal application

- [ ] [#148](https://github.com/tjorim/travel/issues/148) Add generic
      owner-inbox and email reminders for trip tasks; a due date alone
      schedules nothing. Implementation is ready locally.

### v2 — Fresh VPS launch and live trip delivery

- [ ] [#457](https://github.com/tjorim/travel/issues/457) Remote video derivative
      adapter and durable dispatcher implemented locally; keep explicit local
      mode and binaries until parity/cutover/rollback verification in
      [apps#275](https://github.com/tjorim/apps/issues/275). No new publication
      permissions or media sources.
- [ ] [apps#226](https://github.com/tjorim/apps/issues/226) Wire the owner MCP
      tools through the production Caddy and Keycloak boundary after #41.
- [ ] [apps#230](https://github.com/tjorim/apps/issues/230) Schedule the
      alert processor and configure the per-owner SMTP mapping on the VPS.

## Confirmed release targets

### v1 — Private travel journal application

v1 delivers a feature-complete private Travel app in local/test environments.
It uses test content only; production content begins with the fresh launch.

- One account owner creates and edits all data. Trips are owner-only by
  default; each can have an optional, owner-selected public follower view and
  named revocable high-entropy custom links with separately selected detail.
  There are no viewer accounts or sharing groups.
- "Private" means access-controlled service data, protected in transit and at
  rest. End-to-end encryption is not a v1 requirement.
- Link scopes and server-enforced redaction protect items and sensitive fields;
  a client never receives hidden locations, links, files or metadata.
- Locations, exact stays, automatic owner-only media uploads and selected offline
  copies are included. Recorded GPS tracks, continuous and live, are excluded;
  routes are drawn by hand.
- Google Photos Picker import is included; GoPro Cloud import is included when
  beta access is granted, with direct device upload as the enduring fallback.
- MCP management tools are implemented and verified locally against the same
  application service layer; they are not exposed through the production VPS
  until the v2 cutover.
- The owner can select private OSM places and launch authorized Google Maps
  navigation; other viewers receive only their intended, general representation.

v1 exit condition: the owner can manage a test trip entirely in the app,
including itinerary, shared essentials, offline selections and rendered
publication previews. Public/unlisted test visitors can discover published
trips and see only deliberately shared stories, galleries and maps, proven by
authorization, redaction and integration tests.

### v2 — Fresh VPS launch and live trip delivery

v2 launches the completed app on the shared VPS with new application content.
There is no archive import or old URL preservation requirement.

- Store new structured trip content in the database and new documents, media
  and derivatives in backed-up VPS object storage.
- Serve public and unlisted trip views live from explicitly published,
  server-filtered app data. Deploy frontend application code only, never a
  generated trip page or user content from Git.
- Wire the already-tested MCP service through the production Caddy and Keycloak
  boundary with the same owner authorization and audit rules.
- Stop serving all `dist/` trip and private archive URLs at launch. Devices
  that saved archive documents offline are cleaned up manually (decision 101).

v2 exit condition: no new app user content is added to Git and no `dist/`
trip content is served; public/unlisted routes are live and server-filtered,
and the owner can use the already-tested MCP service through its production
boundary. Old archive files remain in the repository for separate #40 work.

### v3 — No committed delivery scope

v3 is deliberately unplanned. MCP application tools are part of v1, and their
production connection is part of v2. New v3 work requires a fresh product
decision rather than inventing a release to hold it.

## Confirmed out of scope through v3

Collaborative editing, end-to-end encryption, continuous/live GPS tracking,
public default sharing, generic external automation, and further social
Polarsteps-like features require a fresh product and privacy decision.

## Recently completed

- [x] [#305](https://github.com/tjorim/travel/issues/305) Capped concurrent
      video derivative jobs and added explicit, reviewable Dutch/English draft
      translation of owner text on the on-demand service from
      [apps#250](https://github.com/tjorim/apps/issues/250) and apps#252. See
      [translation drafts](docs/translation-drafts.md).

- [x] [#284](https://github.com/tjorim/travel/issues/284) Added the Dutch/English
      locale foundation and shared shell.
- [x] [#285](https://github.com/tjorim/travel/issues/285) Added stable API error
      codes and render-time localized feedback.
- [x] [#286](https://github.com/tjorim/travel/issues/286) Translated owner
      workspaces, shared editors, capture and map controls.
- [x] [#287](https://github.com/tjorim/travel/issues/287) Translated private
      assets, publication, library and offline packing workflows.
- [x] [#288](https://github.com/tjorim/travel/issues/288) Completed public and
      unlisted visitor presentation in Dutch and English.
- [x] [#289](https://github.com/tjorim/travel/issues/289) Completed extraction
      and locale regressions, with CI catalogue, type and string audit gates.
- [x] [#281](https://github.com/tjorim/travel/issues/281) Recorded the
      [interface translation decisions](docs/decisions/281-interface-translations.md)
      and delivered the implementation sequence above.

- [x] [#264](https://github.com/tjorim/travel/issues/264) Migrated owner,
      public and unlisted presentation to Tailwind utilities and named theme
      tokens, removed the legacy class allowlist, and moved shared record,
      discard and delete dialogs to Base UI while retaining dismissal safeguards.

- [x] [#176](https://github.com/tjorim/travel/issues/176) Kept both library
      and trip documents owner-only; removed document twins, share choices,
      visitor fields and MCP derivative tools. Deleting a document now purges
      its stored original, and migration 001 hands retired twin files to the
      existing purge job.

- [x] Merged route stages and day-plan steps into *visits* (*bezoeken*): a stop
      at an area or a location with optional days, times, kind and a text for
      visitors, shared like any record, with the time private unless chosen.
      The day plan became a read-only agenda; routes and visits share one
      grouped area/location picker.

- [x] Unified the place vocabulary and dropped raw GPS tracks. A *gebied*
      (area) is a city or region and a *locatie* (location) is an address-level
      place, or just a city, filed under one area, in separate tables, in the API, database, MCP
      tools, PWA and docs; the words "broad", "exact" and "spot" are gone.
      Every stay has a location and takes its area from it; reisupdates can
      still link to an area. The GPX/point-array track upload and its record
      are removed. Transport legs and drawn map routes became one *route*
      between two areas with a travel mode; locations, schedule, booking
      details and a drawn line (with movable points) are optional, and the
      maps style each line by mode. The Gebieden section absorbed the separate
      area overview, leaving Gebieden, Locaties and Bezoeken.

- [x] [#140](https://github.com/tjorim/travel/issues/140) Closed the remaining
      static-archive parity gaps: stays as nights per city/area (also while
      still choosing), time-zone-aware transport legs, a richer day plan with
      per-night stays, trip dates and booking badges, task links, and
      scope-selected trip dates, highlights and stage summaries for visitors.

- [x] [#137](https://github.com/tjorim/travel/issues/137) Removed the retired
      Go `travel-auth` service, its CI and Dependabot paths, and the
      shared-password setup; the local Compose and Caddy example now mirror
      the production owner, public and unlisted routes.

- [x] [#41](https://github.com/tjorim/travel/issues/41) Added and locally
      tested 104 typed owner MCP tools for canonical trip, place, itinerary,
      asset, audience, preview and lifecycle workflows. Calls use the same
      owner validation/storage handlers as the application, require explicit
      confirmation for deletion and externally visible changes, and write a
      payload-free authenticated invocation audit record. Production routing
      remains [apps#226](https://github.com/tjorim/apps/issues/226).

- [x] [apps#219](https://github.com/tjorim/apps/issues/219) and
      [apps#220](https://github.com/tjorim/apps/issues/220) Added private VPS
      media storage, the live `/admin/`, `/`, `/trips/` and `/share/` routes,
      the owner Keycloak callback, database-plus-media backup and restore
      verification, and scheduled retention purges in apps#223. Production MCP
      wiring moved to apps#226.

- [x] [#119](https://github.com/tjorim/travel/issues/119) Added scoped
      MapLibre maps to the React owner, public and unlisted views. Visitor
      maps are built only from the delivered projection's selected area
      points and routes; the owner map adds locations, with optional Mapterhorn terrain and Esri
      imagery. Keyboard stop selection, route-in-words and WebGL/tile failure
      fallbacks are included.

- [x] [#125](https://github.com/tjorim/travel/issues/125) Added live published-trip
      discovery at `/` and `/trips/`, with scope-filtered public cards, stable
      slugs, and accessible loading, error and empty states. Production routes
      were added in [apps#219](https://github.com/tjorim/apps/issues/219).

- [x] [#126](https://github.com/tjorim/travel/issues/126) Added an owner-only
      rendered preview for public and named-link publication scopes using the
      visitor components, with scoped preview files and navigation before
      activation and after withdrawal.

- [x] [#120](https://github.com/tjorim/travel/issues/120) Added live
      chronological visitor stories with stable moment links, authored dates at
      the selected precision, areas, and responsive galleries of
      explicitly shared media derivatives, plus owner controls for captions,
      alt text, focal position and moment association.

- [x] [#124](https://github.com/tjorim/travel/issues/124) Added owner-selected
      offline private copies to the React PWA: explicit per-item pin, inspect,
      remove and clear-all controls for library documents, trip documents and
      emergency-info entries, encrypted on-device under #36's device-scoped
      offline policy with a short revalidated lease, no durable access token,
      and full wipe on sign-out.

- [x] [#131](https://github.com/tjorim/travel/issues/131) Extended explicit
      owner offline pinning to private media, GeoJSON map/route snapshots and
      individual itinerary entries, reusing the encrypted per-device store and
      short revalidated lease. Map snapshots have a dedicated owner-only
      revalidation endpoint and deliberately exclude provider map tiles.

- [x] [#123](https://github.com/tjorim/travel/issues/123) Added an owner-wide
      document library and emergency-information page: reusable documents and
      contacts/numbers/medical notes scoped directly to the owner subject
      rather than to a trip, with an optional link from a document to a trip.
      Neither resource is ever projected onto a public/unlisted trip response.

- [x] [#122](https://github.com/tjorim/travel/issues/122) Built an owner day
      plan and booking task list for each trip: manually ordered itinerary
      entries that can link to an existing stay, transport leg, route stage,
      location, document or moment, plus a lightweight task list with due
      dates and a complete/incomplete state. Both are owner-only, with no
      share-scope kind of their own.

- [x] [#121](https://github.com/tjorim/travel/issues/121) Added owner-managed
      flight and transport itinerary records: departure/arrival locations,
      times, carrier/service reference, booking status, notes and optional
      linked documents, with owner API and React manager coverage. A leg has
      no share-scope kind of its own; a follower representation stays a
      separately authored route stage or route, never copied from it.

- [x] [#73](https://github.com/tjorim/travel/issues/73) Built the Travel
      application delivery contract and live, server-filtered public/unlisted
      visitor views through #89 and #90. Owner publication and link actions
      update database access state; trip content is fetched at request time
      without generated pages. Production routing and storage followed in
      [apps#219](https://github.com/tjorim/apps/issues/219); richer app
      presentation and workflows followed in #119–#126.

- [x] [#34](https://github.com/tjorim/travel/issues/34) Replaced the three
      static archive SVG route maps with one MapLibre renderer and separate
      public/private GeoJSON files. The maps use geographic basemaps, visible
      provider attribution, keyboard-operable stops and textual fallbacks;
      public route data remains approximate under #36's privacy contract.

- [x] [#38](https://github.com/tjorim/travel/issues/38) Evolved the tracker
      API and PWA into the private Travel content app through its seven
      ordered phases: canonical places and excerpts, stays and stay
      cards, recorded tracks and routes, documents, generic share
      scopes, content-management UI, and publication/media-management UI.
      Owner-only mutation, redacted public and unlisted responses, explicit
      location capture, privacy-safe sharing derivatives, media imports and
      selected offline copies are covered by regression tests.

- [x] Completed the tracker PWA content-management phase: owners can now
      manage trips, canonical moments and separately authored excerpts; select
      exact and areas; manage exact stays and stay cards; upload,
      review and remove private documents; arrange
      route stages; upload finished GPX/point-array tracks; and author
      routes. The client uses the existing PKCE session, keeps exact
      data and files behind owner-only endpoints, and provides no continuous
      location-capture control. ([#61](https://github.com/tjorim/travel/issues/61),
      [#94](https://github.com/tjorim/travel/issues/94),
      [#95](https://github.com/tjorim/travel/issues/95),
      [#96](https://github.com/tjorim/travel/issues/96))

- [x] Added configurable, attributed, owner-only OSM place search with a
      bounded in-memory confidential-query cache; locations now retain the
      durable OSM element type/ID pair and an owner-selected display snapshot,
      never Nominatim's transient `place_id`. Explicit owner-only reverse
      geocoding returns the same selectable result without creating a place,
      so the later EXIF suggestion flow uses this path. Google Maps destinations are
      generated only after owner or public/unlisted scope resolution. Exact
      destinations require an explicit `location` navigation capability;
      other selected navigation markers resolve only to city-level targets.
      ([#39](https://github.com/tjorim/travel/issues/39))

- [x] Added private `travel/recorded-track@1` records and separately authored
      `travel/route@1` records to the tracker API. A finished GPX or
      point-array track is uploaded in one bounded owner action with required
      start/end times, then copied through the checksum-verified
      `StoredObject` pipeline; no partial, streaming, or live-tracking route
      exists. Its raw points and timestamps remain owner-only. A route
      instead stores the owner's reviewed GeoJSON line and date precision,
      with no raw-track link or request-time derivation path. Owner-only and
      public-surface regression tests enforce both boundaries. Third of #38's
      seven delivery phases. ([#58](https://github.com/tjorim/travel/issues/58))

- [x] Added owner-managed `travel/stay@1` records and separately authored
      `travel/stay-card@1` records to the tracker API. Stays retain an
      location, booked arrival/departure dates, optional verified times, property, booking/contact
      details and notes behind the owner boundary; a stay card has only
      an owner-selected area, title and date precision, with no link
      back to a stay. Owner CRUD, cross-owner 404s, and projection no-leak
      tests enforce that a card cannot disclose stay data. Second of #38's
      seven delivery phases. ([#57](https://github.com/tjorim/travel/issues/57))

- [x] Split the tracker API's flat MVP `Place` into the canonical
      `travel/place@1` `location`/`area` model and added the standalone
      `moment_excerpt` resource: a route stage always references an `area`
      place, a moment always references a `location`, and an owner can
      create, edit and delete a moment excerpt independent of its source
      moment's lifecycle. First of #38's seven delivery phases.
      ([#56](https://github.com/tjorim/travel/issues/56))

- [x] Added an owner-only audit trail for the tracker API's publication and
      share-link lifecycle: an `audit_events` table records every
      public-projection publish/unpublish and every share-link
      create/activate/revoke/rotate, plus a link's natural expiry, with the
      link/projection id, owner action, a scope fingerprint, and an optional
      owner-entered reason, never a raw capability token, recipient
      identity, or recipient IP. A new owner-only
      `GET /trips/{trip_id}/audit-events` endpoint reads a trip's history.
      `purge_expired_audit_events` hard-deletes events past the sharing
      policy's 24-month retention window as pure application code, run
      manually for v1. ([#48](https://github.com/tjorim/travel/issues/48))

- [x] Added a durable, owner-only media ingestion pipeline: direct device
      upload (the always-available fallback), a Google Photos Picker session
      flow that imports only explicitly selected items, and a GoPro Cloud
      adapter behind a provider interface, gated off until beta access is
      granted so the product stays fully usable without it. Every imported or
      uploaded file is copied into Travel-controlled object storage,
      checksum-verified, and deduplicated per trip; a provider URL or token is
      never the servable reference or stored in the database. Interrupted
      provider imports retry idempotently per item with no duplicate records;
      originals and raw EXIF/XMP/IPTC stay owner-only and untouched on
      ingest, with a best-effort capture time/camera/GPS read kept alongside
      them to pre-fill a moment's date or place for the owner, and a
      stripped, resized share derivative is generated only on explicit owner
      request and gated on owner review before it may ever be referenced by
      a share scope. Deletion is a soft delete with a dedup-safe purge
      helper for the recoverable-deletion window. Tests use provider fakes
      throughout; no
      test makes a real network call. ([#43](https://github.com/tjorim/travel/issues/43))

- [x] Implemented scoped, revocable public and unlisted publication links for
      the tracker API's trips and moments: an explicit, owner-selected scope
      (never a full-trip serialization) that renders live from current trip
      data, so adding, removing or editing a shared item reaches visitors
      immediately with no republish step; only whether a page is served at
      all is gated (publish/unpublish; activate/revoke/rotate for a named
      unlisted link); named unlisted share links with 256-bit capability
      tokens (only a keyed verifier is stored) and a 1-90 day (default 30)
      expiry or an explicit no-expiry owner choice; `no-store`, `noindex` and
      `no-referrer` delivery headers; and
      tests covering public, valid-link, revoked-link, rotated-link,
      expired-link and out-of-scope-resource responses.
      ([#42](https://github.com/tjorim/travel/issues/42))

- [x] Defined the versioned canonical Travel content model: owner-scoped
      resources and object storage, separately authored, derived share
      representations, immutable public and unlisted projections, capability
      lifecycle and import records. The later fresh-launch decision removes
      the legacy migration design. ([#37](https://github.com/tjorim/travel/issues/37))
- [x] Defined the Travel application privacy contract: owner-only canonical
      data, private-by-default public follower views and fine-grained
      custom-link projections, server-side redaction, capability lifecycle,
      device-scoped offline copies, and VPS retention/security expectations.
      ([#36](https://github.com/tjorim/travel/issues/36))

- [x] Added a repeatable public-route safety review covering operational data,
      media GPS metadata, file-layout separation, and cache/indexing recovery.
      ([#10](https://github.com/tjorim/travel/issues/10))

- [x] Defined the privacy-first tracker MVP: one owner, private-by-default
      trips, explicit publication, area labels only, and no automatic
      archive migration. ([#20](https://github.com/tjorim/travel/issues/20))

- [x] Added the FastAPI tracker API with authenticated owner CRUD, deliberately
      published read-only trips, Alembic migration, and a local test contract.
      ([#22](https://github.com/tjorim/travel/issues/22))

- [x] Added the installable React PWA shell under `/admin/`, with client-side
      routing, mobile navigation, authenticated-app boundary, and app-shell
      offline cache while preserving the archive. ([#21](https://github.com/tjorim/travel/issues/21))

- [x] Added individual Travel tracker accounts with PKCE, a dedicated API
      audience, and an owner-only subject boundary.
      ([apps#216](https://github.com/tjorim/apps/issues/216))

- [x] Added mobile moment capture with local drafts, deliberate area
      controls, an explicit one-shot location action, and clear sharing state.
      ([#23](https://github.com/tjorim/travel/issues/23))

- [x] Integrated the native Travel session gate into the central infrastructure
      deployment. ([apps#214](https://github.com/tjorim/apps/issues/214))

- [x] Added a native server-side login and logout flow for shared and per-trip
      private routes, with signed secure sessions and Argon2id verification.
      ([#11](https://github.com/tjorim/travel/issues/11))

- [x] Added an accessible public route/places map driven solely by selected
      public trip data. ([#8](https://github.com/tjorim/travel/issues/8))

- [x] Deployed and smoke-tested `travel.tjor.im` on the VPS: `/` is public,
      while `/private/` and every `/<trip>/private/` route are password
      protected. ([#5](https://github.com/tjorim/travel/issues/5))
- [x] Defined the per-trip public/private JSON contract and updated Taiwan to
      render from it. ([#6](https://github.com/tjorim/travel/issues/6))
- [x] Added a reusable, data-driven trip page contract: summary, route stages,
      moments, stays and booking status. ([#2](https://github.com/tjorim/travel/issues/2))
- [x] Built Taiwan's public chronological trip timeline with stable moment
      URLs and a public-data-only renderer. ([#7](https://github.com/tjorim/travel/issues/7))
- [x] Established Git/LFS camera-original storage, public derivative metadata,
      responsive gallery and timeline-media components, and an EXIF-stripping
      preparation workflow. ([#9](https://github.com/tjorim/travel/issues/9))

## Later
- [ ] [#281](https://github.com/tjorim/travel/issues/281) Plan Dutch and English
      interface translations with Paraglide/Inlang, following Bordertax,
      Champagnefestival and Worktime. Record locale selection, unsaved-editor
      behavior, formatting and API-error boundaries before splitting implementation.
- [ ] [#40](https://github.com/tjorim/travel/issues/40) Decide separately
      whether and how to move old `dist/` content out of Git. It is not a
      dependency of the fresh application launch or a source of URL aliases.
- [x] [#229](https://github.com/tjorim/travel/issues/229) Adopt Tailwind CSS
      and Base UI primitives as the styling/behavior stack shared with
      `bordertax`, `champagnefestival`, `daynest` and `worktime`, alongside
      `cn` and a shared Tailwind lint config. This repo has no Bootstrap to
      remove. The owner later revisited the native-dialog convention; #264
      tracks migration of existing dialogs to Base UI Dialog and Alert Dialog.
      Equivalent app work is tracked in bordertax#248,
      champagnefestival#1103, daynest#933 and worktime#1376.
- [x] Generalized the Taiwan-only local SVG route map into a reusable,
      data-driven component with selectable route stops. ([#3](https://github.com/tjorim/travel/issues/3))
- [x] Added opt-in offline copies for selected private documents, with
      per-document removal and a clear-all local-copy action. ([#4](https://github.com/tjorim/travel/issues/4))

## Conventions

- The app is the source of truth for its trip data, private assets and
  sharing policy. Add no new user content or deployable trip assets to Git;
  the existing offline `dist/` archive is separately tracked in #40.
- Serve published trips live through the application boundary. Public and
  unlisted requests always receive only their server-filtered projection.
- Do not use Git history as a document vault for sensitive documents.
- Complete `docs/publication-safety-check.md` before publishing a trip or
  activating a share link.
- Prefer small reusable application components for owner and viewer routes.
- Add a concrete GitHub issue when a new substantial improvement is found,
  including a gap deliberately left out of scope with only a documented
  reason — the reason is not itself tracking; open the issue in whichever of
  `tjorim/travel` (application) or `tjorim/apps` (shared VPS infrastructure)
  actually owns doing the work, per `AGENTS.md`. Update this plan when an
  issue's relative order changes.
