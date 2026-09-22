# Travel plan

This is the working order for the Git-backed travel hub. The static archive
remains Git-backed, while the tracker PWA and API are deployed through the
central VPS infrastructure.

The `Now`, `Next` and `Later` sections mirror the open GitHub issues in their
working order. When an issue is closed, move it to `Recently completed` and
record the delivered change in `CHANGELOG.md`.

## Data boundary

Public routes contain the story of a trip: intentionally selected photos,
moments, broad route stages, cities and places.

Private routes contain operational information: documents, ticket/booking
references, exact accommodation, emergency contacts and near-real-time plans.
Do not make a file public merely because it is not secret; public trip data is
deliberately selected data.

## Recently completed

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

- [ ] Generalize the Taiwan-only local SVG route map into a reusable component.
      ([#3](https://github.com/tjorim/travel/issues/3))
- [x] Added opt-in offline copies for selected private documents, with
      per-document removal and a clear-all local-copy action. ([#4](https://github.com/tjorim/travel/issues/4))
- [ ] Add the next trip by creating `dist/<trip-slug>/` with its own public and
      private data rather than copying Taiwan-specific markup.

## Conventions

- Git is the source of truth for content and documents.
- Keep the public site static and dependency-light.
- Complete `docs/public-route-safety-check.md` before deploying a public-route
  change.
- Prefer small reusable browser components in `dist/assets/travel/`.
- Add a concrete GitHub issue when a new substantial improvement is found;
  update this plan when its relative order changes.
