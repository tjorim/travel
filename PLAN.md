# Travel plan

This is the working order for Travel. It is evolving from a Git-backed archive
with a small tracker into a private, privacy-gradient travel journal: a custom
Polarsteps-style app for active trips, with a deliberately published static
archive. The tracker PWA and API are deployed through the central VPS
infrastructure.

The `Now`, `Next` and `Later` sections mirror the open GitHub issues in their
working order. When an issue is closed, move it to `Recently completed` and
record the delivered change in `CHANGELOG.md`.

## Product direction

The Travel app will become the source of truth for active trip data, archive
content, private assets and sharing rules. Git is for application code, tests,
schemas, migrations, documentation and infrastructure only; it is not file
storage for user content, media, documents or published archive output.

The static archive remains a useful, dependency-light read-only destination;
it is generated from deliberately published app data and deployed from
application-controlled VPS storage, not committed as trip content. It is a
public or unlisted trip page,
not a backup and not an automatic record of every private item. Publication
from the app must be an explicit action. The existing Git-backed archive is
legacy content to move in an explicit, audited migration, not through ongoing
automatic replication.

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
backup automation or legacy content. Those operational changes begin only in
v2 after the app behavior is complete and verified.

### v1 — Private travel journal application

- [ ] [#34](https://github.com/tjorim/travel/issues/34) Replace the SVG maps
      with a shared MapLibre renderer, reconciled with #36's privacy contract.
- [ ] [#38](https://github.com/tjorim/travel/issues/38) Evolve the tracker
      API and PWA into the private Travel content app. Too large for one PR;
      delivered as seven ordered phases, each its own issue/PR, per
      #37's "Implementation gates" section:
  - [x] [#56](https://github.com/tjorim/travel/issues/56) Split Travel
        places into exact and broad models.
  - [ ] [#57](https://github.com/tjorim/travel/issues/57) Add owner-managed
        stays and broad stay cards to Travel.
  - [ ] [#58](https://github.com/tjorim/travel/issues/58) Add recorded
        tracks and broad routes to Travel.
  - [ ] [#59](https://github.com/tjorim/travel/issues/59) Add owner-managed
        documents to Travel.
  - [ ] [#60](https://github.com/tjorim/travel/issues/60) Extend Travel
        share scopes to cover every resource type.
  - [ ] [#61](https://github.com/tjorim/travel/issues/61) Build tracker PWA
        UI for trip content management.
  - [ ] [#62](https://github.com/tjorim/travel/issues/62) Build tracker PWA
        UI for publication and media management.
- [ ] [#41](https://github.com/tjorim/travel/issues/41) Develop and test
      narrow owner-authenticated MCP management tools against the app service
      layer.
- [ ] [#39](https://github.com/tjorim/travel/issues/39) Add privacy-aware OSM
      place search and Google Maps navigation.

### v2 — VPS cutover, Git-content retirement and archive publishing

- [ ] [apps#219](https://github.com/tjorim/apps/issues/219) Add Travel
      application publication and private-media storage to the shared VPS.
- [ ] [#40](https://github.com/tjorim/travel/issues/40) Migrate user content
      and deployable archive assets out of Git.
- [ ] [apps#220](https://github.com/tjorim/apps/issues/220) Extend backup and
      restore verification to Travel media storage.

## Confirmed release targets

### v1 — Private travel journal application

v1 delivers a feature-complete private Travel app in local/test environments.
It deliberately does not migrate or serve production user content yet.

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
- Public and private maps consume distinct, audience-appropriate data. The
  MapLibre work in [#34](https://github.com/tjorim/travel/issues/34) must be
  reconciled with the privacy contract in [#36](https://github.com/tjorim/travel/issues/36).

v1 exit condition: the owner can manage a test trip entirely in the app and
public/unlisted test visitors can see only deliberately shared content, proven
by authorization, redaction and integration tests.

### v2 — VPS cutover, Git-content retirement and published archive

v2 enables the completed app on the shared VPS and makes it the only home for
Travel content, including legacy content.

- Migrate structured trip/archive content to the database and all documents,
  media, derivatives and generated archive files to backed-up VPS object
  storage.
- Generate and deploy the static archive only from explicitly published app
  data; keep the archive static and dependency-light for its readers.
- Wire the already-tested MCP service through the production Caddy and Keycloak
  boundary with the same owner authorization and audit rules.
- Audit Git and Git LFS history handling, validate the migration and retire the
  legacy Git-backed deploy paths.

v2 exit condition: Git holds only software and operational configuration; no
user content or deployable archive asset is added or served from it, and the
owner can use the already-tested MCP service through its production boundary.

### v3 — No committed delivery scope

v3 is deliberately unplanned. MCP application tools are part of v1, and their
production connection is part of v2. New v3 work requires a fresh product
decision rather than inventing a release to hold it.

## Confirmed out of scope through v3

Collaborative editing, end-to-end encryption, continuous/live GPS tracking,
public default sharing, generic external automation, and further social
Polarsteps-like features require a fresh product and privacy decision.

## Recently completed

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
      lifecycle, public static-export invalidation, import records, and an
      explicit one-time legacy migration design. ([#37](https://github.com/tjorim/travel/issues/37))
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

- [x] Added the installable React PWA shell under `/tracker/`, with client-side
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

- [x] Generalized the Taiwan-only local SVG route map into a reusable,
      data-driven component with selectable route stops. ([#3](https://github.com/tjorim/travel/issues/3))
- [x] Added opt-in offline copies for selected private documents, with
      per-document removal and a clear-all local-copy action. ([#4](https://github.com/tjorim/travel/issues/4))
- [ ] Add the next trip by creating `dist/<trip-slug>/` with its own public and
      private data rather than copying Taiwan-specific markup.

## Conventions

- The app is the source of truth for trip/archive data, private assets and
  sharing policy. Git contains only code, tests, schemas, migrations,
  documentation and infrastructure; never user content or deployable assets.
- Keep the published archive static and dependency-light. Purposeful app
  dependencies are allowed behind its authenticated product boundary.
- Do not use Git history as a document vault for sensitive documents.
- Complete `docs/public-route-safety-check.md` before deploying a public-route
  change.
- Prefer small reusable browser components in `dist/assets/travel/`.
- Add a concrete GitHub issue when a new substantial improvement is found,
  including a gap deliberately left out of scope with only a documented
  reason — the reason is not itself tracking; open the issue in whichever of
  `tjorim/travel` (application) or `tjorim/apps` (shared VPS infrastructure)
  actually owns doing the work, per `AGENTS.md`. Update this plan when an
  issue's relative order changes.
