# Fresh launch route boundary

This decision revises #101 for the fresh Travel application launch. The app has
not served production trip views, so there are no application URLs or user
records to migrate or preserve. The live browser routes are defined in
[the #103 contract](103-live-browser-route-contract.md).

## Launch routes

| Path | Owner at launch |
|---|---|
| `/` | Data-free public landing shell with published application trip discovery and an entry to the owner app. It requests the live public listing; it does not serve archive trips or disclose unpublished trips. |
| `/trips/` | The same public trip index, with links to current published application trips. |
| `/admin/*` | Owner application shell and owner session. |
| `/api/*` | Travel API, including scoped public and unlisted projections. |
| `/trips/{slug}` | Public visitor shell; requests only the current public projection. |
| `/share/{token}` | Unlisted visitor shell; requests only the current capability projection. |
| Former `dist/` trip, asset and private URLs, including `/exampleland-2054/` | Unavailable at launch (404 or 410); no static archive serving or live alias. |
| Other paths | Explicit application assets or 404. No catch-all trip fallback. |

The owner creates trips in the application, selects each public or unlisted
scope, and explicitly publishes or activates it. Public slugs and share tokens
are issued by the application. No `dist/` trip data, document or media asset is
imported at launch. Old `/<trip-slug>/` URLs do not map to live views; there
is no deep-link redirect, fragment mapping or static page fallback. Existing
Git-backed archive content is not an application data source or a source of
publication defaults. At launch the VPS stops serving `dist/` trip pages,
assets and protected files. The files can remain in the repository while
offline; their disposition is independent of launch. Any later work on them is
tracked separately in [#40](https://github.com/tjorim/travel/issues/40).

A live request stays within its boundary. A 404, unavailable capability, API
failure or network failure never falls through to a static file, owner route or
cached archive page. Former private archive URLs do not become owner or
unlisted app routes.

## Launch verification and ownership

`/`, `/trips/*` and `/share/*` load data-free visitor shells. The root and
`/trips/` index request the server-filtered public listing on each load. Every trip request
reaches its scoped API endpoint, where publication or capability state and scope
are checked at request time. The launch route check covers published,
unpublished, missing, revoked and expired states, direct reloads, API errors,
cache headers and private-path isolation. The unlisted shell and responses use
the no-store, no-referrer, noindex and token-log protections in #103.
Also verify that no `dist/` asset is reachable through the new route boundary.

[tjorim/apps#219](https://github.com/tjorim/apps/issues/219) added the new
production routes without any `dist/` serving. There is no content-migration
or rollback-parity dependency on #40.

Two earlier launch requirements were dropped on 23 September 2026. Old archive
paths are not required to return 404/410: the new boundary serves no archive
content, so an unmatched path returns Caddy's empty response. The archive's
root-scoped `/travel-offline-service-worker.js` is not retired by the
deployment either. It registers only when someone saves a private archive
document for offline use, and any such device is cleaned up manually.
