# Travel plan

This is the ordered list of open work for Travel, a private, privacy-gradient
travel journal: a FastAPI backend and a React PWA for active trips and
deliberately published trip views. Every open item below is an open issue in
`tjorim/travel`. Completed work is recorded in `CHANGELOG.md`, not here; update
this plan when an issue closes or its order changes.

## Product direction

This public source repository is separate from the personal instance and its
private archive. Keep operational data
out of public source and use synthetic fixtures; see the brief
[source privacy guidance](docs/source-privacy.md).

The Travel app will become the source of truth for its trips, private assets
and sharing rules. No new app content belongs in Git. The retired archive is privately preserved in application object storage.

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
stores exact owner-only live tracks only under decision 244; finished-file import may only
seed a reviewed two-decimal approximate route (decision 243). How the owner
travels is an approximate route reviewed by the owner, with a travel mode, and no exact or
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

## Open work

Source review clean-up, found at commit `def2173` and tracked by [#373](https://github.com/tjorim/travel/issues/373) (order as agreed there). It is separate from #9, which tracked the 2026-10 application review defects.

### Correctness first

- [ ] [#357](https://github.com/tjorim/travel/issues/357) Derive a travel update's shared date from its local day, not UTC.

### Decisions that shape the rest

- [ ] [#358](https://github.com/tjorim/travel/issues/358) One convention for dates, times and record names.
- [ ] [#364](https://github.com/tjorim/travel/issues/364) Align audit tables; decide what survives trip deletion.
- [ ] [#374](https://github.com/tjorim/travel/issues/374) Manage visits, stays and routes from the agenda.
- [ ] [#368](https://github.com/tjorim/travel/issues/368) Merge the parallel trip and library document models.

### Contract and structure

- [ ] [#363](https://github.com/tjorim/travel/issues/363) Bring the live-location API and tables in line.
- [ ] [#362](https://github.com/tjorim/travel/issues/362) Generate frontend API types from OpenAPI.
- [ ] [#369](https://github.com/tjorim/travel/issues/369) Move domain logic out of routers into shared services.
- [ ] [#366](https://github.com/tjorim/travel/issues/366) API convention, outlier resources and error codes.
- [ ] [#386](https://github.com/tjorim/travel/issues/386) Rename a travel update's `date_precision` to `share_date_precision` (the one rename chosen in #358; phase 4, with #367 and #357).

### Independent tidy-ups

- [ ] [#371](https://github.com/tjorim/travel/issues/371) Prune and regroup the message catalogue.
- [ ] [#370](https://github.com/tjorim/travel/issues/370) Separate visitor, owner and shared frontend source.
- [ ] [#376](https://github.com/tjorim/travel/issues/376) Authored content in Dutch and English, with fallback.

### Earlier follow-ups

- [ ] [#8](https://github.com/tjorim/travel/issues/8) Complete scoped end-to-end validation after the application review.
- [ ] [#9](https://github.com/tjorim/travel/issues/9) Track application review improvements and follow-up validation.
- [ ] [#94](https://github.com/tjorim/travel/issues/94) Decide which Polarsteps gaps to pursue.
- [ ] [#84](https://github.com/tjorim/travel/issues/84) Avoid materializing base64 JSON for large MCP uploads.
- [ ] [#242](https://github.com/tjorim/travel/issues/242) Suggest a route line between its two areas.
- [ ] [#321](https://github.com/tjorim/travel/issues/321) Manual screen-reader validation of tagged PDFs.

Dependency updates are tracked in [#290](https://github.com/tjorim/travel/issues/290).

## Conventions

- The app is the source of truth for its trip data, private assets and
  sharing policy. Add no new user content or deployable trip assets to Git.
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

## Live location exception (#244, 2026-11-09)

The owner explicitly approved exact live-track storage and current-only audience
sharing. Earlier blanket no-GPS-history/live-location statements are superseded
only by [decision 244](docs/decisions/244-live-location-tracks.md).
Tracks stay owner-only until explicit deletion; freshness expiry preserves them.
Review each enabled audience and its delivered precision before sharing. Live
coordinates and tracks are excluded from PDF, Atom and ordinary trip exports;
owner track export is a separate deliberate download. Database and HA backups
may retain deleted history until their independent retention expires.