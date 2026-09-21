# Travel plan

This is the working order for the Git-backed travel hub. It is intentionally a
small static-site plan: commits change the site and the VPS deploys those
commits. There is no separate publishing service or application database.

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

- [x] Deployed and smoke-tested `travel.tjor.im` on the VPS: `/` is public,
      while `/private/` and every `/<trip>/private/` route are password
      protected. ([#5](https://github.com/tjorim/travel/issues/5))
- [x] Defined the per-trip public/private JSON contract and updated Taiwan to
      render from it. ([#6](https://github.com/tjorim/travel/issues/6))
- [x] Added a reusable, data-driven trip page contract: summary, route stages,
      moments, stays and booking status. ([#2](https://github.com/tjorim/travel/issues/2))

## Now

## Next

- [ ] Build the public chronological trip-timeline view.
      ([#7](https://github.com/tjorim/travel/issues/7))
- [ ] Add a public route/places map driven only by public trip data.
      ([#8](https://github.com/tjorim/travel/issues/8))
- [ ] Establish the Git/LFS media layout, captions, alt text and safe public
      derivatives. ([#9](https://github.com/tjorim/travel/issues/9))
- [ ] Add the public-data safety check before a deployment.
      ([#10](https://github.com/tjorim/travel/issues/10))

## Later

- [ ] Generalize the Taiwan-only local SVG route map into a reusable component.
      ([#3](https://github.com/tjorim/travel/issues/3))
- [ ] Add opt-in offline copies for selected private documents; never cache all
      private files automatically. ([#4](https://github.com/tjorim/travel/issues/4))
- [ ] Add the next trip by creating `dist/<trip-slug>/` with its own public and
      private data rather than copying Taiwan-specific markup.

## Conventions

- Git is the source of truth for content and documents.
- Keep the public site static and dependency-light.
- Prefer small reusable browser components in `dist/assets/travel/`.
- Add a concrete GitHub issue when a new substantial improvement is found;
  update this plan when its relative order changes.
