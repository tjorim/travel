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
moments, broad route stages, cities and places.

The app is private by default. The account owner is the only person who can
sign in, create or edit data. There are no viewer accounts or sharing groups.
For each private-by-default trip, the owner can select its broad public follower
view and/or create custom revocable high-entropy unlisted links with deliberately
selected scopes. A custom link can show more or different detail than the
public view. An unlisted link is a forwardable capability rather than proof of
a recipient's identity. The backend produces the matching redacted response and
must not send data to a client merely to hide it in the UI.

Exact coordinates, addresses, booking references, documents, unredacted media
metadata, precise schedules and private journal entries are sensitive by
default. A shared city, broad route or selected place must be a separate,
redacted representation rather than a client-side mask of an exact record.

Exact location capture, stays, media uploads and device-scoped offline copies
are in scope. They remain owner-only until shared deliberately. The product
does not include continuous or live GPS tracking: location capture is a
deliberate user action, and no exact or near-real-time location is published
automatically.

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

- [ ] [#119](https://github.com/tjorim/travel/issues/119) Render scoped
      interactive maps in the React owner and visitor views.
- [x] [#120](https://github.com/tjorim/travel/issues/120) Build chronological
      trip stories and responsive galleries in live visitor views.
- [ ] [#126](https://github.com/tjorim/travel/issues/126) Show the rendered
      visitor preview in owner publication controls.
- [ ] [#125](https://github.com/tjorim/travel/issues/125) Add published-trip
      discovery to the new Travel landing page.
- [ ] [#41](https://github.com/tjorim/travel/issues/41) Develop and test
      complete owner-authenticated MCP workflows for every #38 resource and
      #73 owner-side publication/preview operation, using typed tools against
      the app service layer.
### v2 — Fresh VPS launch and live trip delivery

- [ ] [apps#219](https://github.com/tjorim/apps/issues/219) Add Travel
      private-media storage and live application routing to the shared VPS.
- [ ] [apps#220](https://github.com/tjorim/apps/issues/220) Extend backup and
      restore verification to Travel media storage.

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
- Exact locations, deliberately recorded private tracks, exact stays,
  automatic owner-only media uploads and selected offline copies are included.
  Continuous/live GPS tracking is excluded.
- Google Photos Picker import is included; GoPro Cloud import is included when
  beta access is granted, with direct device upload as the enduring fallback.
- MCP management tools are implemented and verified locally against the same
  application service layer; they are not exposed through the production VPS
  until the v2 cutover.
- The owner can select private OSM places and launch authorized Google Maps
  navigation; other viewers receive only their intended broad representation.

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
- Stop serving all `dist/` trip and private archive URLs at launch. Verify
  the old root-scoped service worker cannot answer old or new routes.

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

- [x] [#124](https://github.com/tjorim/travel/issues/124) Added owner-selected
      offline private copies to the React PWA: explicit per-item pin, inspect,
      remove and clear-all controls for library documents, trip documents and
      emergency-info entries, encrypted on-device under #36's device-scoped
      offline policy with a short revalidated lease, no durable access token,
      and full wipe on sign-out. Extending pinning to media, maps and
      itinerary resources is tracked separately in
      [#131](https://github.com/tjorim/travel/issues/131), pending #119/#120.

- [x] [#123](https://github.com/tjorim/travel/issues/123) Added an owner-wide
      document library and emergency-information page: reusable documents and
      contacts/numbers/medical notes scoped directly to the owner subject
      rather than to a trip, with an optional link from a document to a trip.
      Neither resource is ever projected onto a public/unlisted trip response.

- [x] [#122](https://github.com/tjorim/travel/issues/122) Built an owner day
      plan and booking task list for each trip: manually ordered itinerary
      entries that can link to an existing stay, transport leg, route stage,
      exact place, document or moment, plus a lightweight task list with due
      dates and a complete/incomplete state. Both are owner-only, with no
      share-scope kind of their own.

- [x] [#121](https://github.com/tjorim/travel/issues/121) Added owner-managed
      flight and transport itinerary records: departure/arrival exact places,
      times, carrier/service reference, booking status, notes and optional
      linked documents, with owner API and React manager coverage. A leg has
      no share-scope kind of its own; a follower representation stays a
      separately authored route stage or broad route, never copied from it.

- [x] [#73](https://github.com/tjorim/travel/issues/73) Built the Travel
      application delivery contract and live, server-filtered public/unlisted
      visitor views through #89 and #90. Owner publication and link actions
      update database access state; trip content is fetched at request time
      without generated pages. Production routing and storage remain in
      [apps#219](https://github.com/tjorim/apps/issues/219); richer app
      presentation and workflows remain in #119–#126.

- [x] [#34](https://github.com/tjorim/travel/issues/34) Replaced the three
      static archive SVG route maps with one MapLibre renderer and separate
      public/private GeoJSON files. The maps use geographic basemaps, visible
      provider attribution, keyboard-operable stops and textual fallbacks;
      public route data remains broad under #36's privacy contract.

- [x] [#38](https://github.com/tjorim/travel/issues/38) Evolved the tracker
      API and PWA into the private Travel content app through its seven
      ordered phases: canonical places and excerpts, stays and broad stay
      cards, recorded tracks and broad routes, documents, generic share
      scopes, content-management UI, and publication/media-management UI.
      Owner-only mutation, redacted public and unlisted responses, explicit
      location capture, privacy-safe sharing derivatives, media imports and
      selected offline copies are covered by regression tests.

- [x] Completed the tracker PWA content-management phase: owners can now
      manage trips, canonical moments and separately authored excerpts; select
      exact and broad places; manage exact stays and broad stay cards; upload,
      review and remove private documents and redacted derivatives; arrange
      broad route stages; upload finished GPX/point-array tracks; and author
      broad routes. The client uses the existing PKCE session, keeps exact
      data and files behind owner-only endpoints, and provides no continuous
      location-capture control. ([#61](https://github.com/tjorim/travel/issues/61),
      [#94](https://github.com/tjorim/travel/issues/94),
      [#95](https://github.com/tjorim/travel/issues/95),
      [#96](https://github.com/tjorim/travel/issues/96))

- [x] Added configurable, attributed, owner-only OSM place search with a
      bounded in-memory confidential-query cache; exact places now retain the
      durable OSM element type/ID pair and an owner-selected display snapshot,
      never Nominatim's transient `place_id`. Explicit owner-only reverse
      geocoding returns the same selectable result without creating a place,
      so the later EXIF suggestion flow uses this path. Google Maps destinations are
      generated only after owner or public/unlisted scope resolution. Exact
      destinations require an explicit `exact_place` navigation capability;
      other selected navigation markers resolve only to city-level targets.
      ([#39](https://github.com/tjorim/travel/issues/39))

- [x] Added private `travel/recorded-track@1` records and separately authored
      `travel/broad-route@1` records to the tracker API. A finished GPX or
      point-array track is uploaded in one bounded owner action with required
      start/end times, then copied through the checksum-verified
      `StoredObject` pipeline; no partial, streaming, or live-tracking route
      exists. Its raw points and timestamps remain owner-only. A broad route
      instead stores the owner's reviewed GeoJSON line and date precision,
      with no raw-track link or request-time derivation path. Owner-only and
      public-surface regression tests enforce both boundaries. Third of #38's
      seven delivery phases. ([#58](https://github.com/tjorim/travel/issues/58))

- [x] Added owner-managed `travel/stay@1` records and separately authored
      `travel/broad-stay-card@1` records to the tracker API. Stays retain an
      exact place, exact arrival/departure times, property, booking/contact
      details and notes behind the owner boundary; a broad stay card has only
      an owner-selected broad place, title and date precision, with no link
      back to a stay. Owner CRUD, cross-owner 404s, and projection no-leak
      tests enforce that a card cannot disclose stay data. Second of #38's
      seven delivery phases. ([#57](https://github.com/tjorim/travel/issues/57))

- [x] Split the tracker API's flat MVP `Place` into the canonical
      `travel/place@1` `exact`/`broad` model and added the standalone
      `moment_excerpt` resource: a route stage always references a `broad`
      place, a moment always references an `exact` place, and an owner can
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
      tokens (only a keyed verifier is stored) and 1-90 day (default 30)
      expiry; `no-store`, `noindex` and `no-referrer` delivery headers; and
      tests covering public, valid-link, revoked-link, rotated-link,
      expired-link and out-of-scope-resource responses.
      ([#42](https://github.com/tjorim/travel/issues/42))

- [x] Defined the versioned canonical Travel content model: owner-scoped
      resources and object storage, separately authored broad/derived share
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
      trips, explicit publication, broad place labels only, and no automatic
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

- [x] Added mobile moment capture with local drafts, deliberate broad-place
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

- [ ] [#131](https://github.com/tjorim/travel/issues/131) Extend owner
      offline pinning to media, maps and itinerary resources. Blocked on
      #119 and #120, which do not exist yet.
- [ ] [#40](https://github.com/tjorim/travel/issues/40) Decide separately
      whether and how to move old `dist/` content out of Git. It is not a
      dependency of the fresh application launch or a source of URL aliases.
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
- Complete `docs/public-route-safety-check.md` before deploying a public-route
  change.
- Prefer small reusable application components for owner and viewer routes.
- Add a concrete GitHub issue when a new substantial improvement is found,
  including a gap deliberately left out of scope with only a documented
  reason — the reason is not itself tracking; open the issue in whichever of
  `tjorim/travel` (application) or `tjorim/apps` (shared VPS infrastructure)
  actually owns doing the work, per `AGENTS.md`. Update this plan when an
  issue's relative order changes.
