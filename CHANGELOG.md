# Changelog

All notable changes to the travel hub are documented here.

## Unreleased

### Added

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
