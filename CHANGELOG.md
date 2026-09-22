# Changelog

All notable changes to the travel hub are documented here.

## Unreleased

### Added

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
