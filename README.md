# Travel

Static travel hub. Exampleland 2054 is its first trip at `/exampleland-2054/`, with a detailed itinerary at `/exampleland-2054/private/`. Shared documents and emergency details live at `/private/`. Future trips can follow the same `dist/<trip-slug>/` layout.

- [PLAN.md](PLAN.md) — ordered work and TODOs
- [CHANGELOG.md](CHANGELOG.md) — implemented changes
- [Privacy, sharing and offline policy](docs/decisions/36-privacy-sharing-offline-policy.md) — v1 access, named-share-link, and redaction contract
- [Canonical content and publication model](docs/decisions/37-canonical-content-and-publication-model.md) — v1 application data, storage, projection, and archive migration contract
- [Live browser route and projection contract](docs/decisions/103-live-browser-route-contract.md) — owner, public, and unlisted browser routes and delivery safeguards
- [Legacy route coexistence and live URL transition](docs/decisions/101-legacy-route-transition.md) — archive URL inventory, route ownership, and staged cutover gates

## Run locally

Serve the `dist` directory with any static web server.

For example:

```bash
python3 -m http.server 8080 --directory dist
```

Then open `http://localhost:8080`.

## VPS deployment

The native session-gate work is active WIP. It provides a small Go service for
the shared-password login flow on `/private/` and every `/<trip>/private/`
route; Caddy asks it before serving a protected file, while `/login` and
`/logout` are served by the same service. There is no database, Keycloak
dependency, or browser-side password material.

The standalone Compose configuration is available for local development and
design verification. Production must instead be wired through the central
`apps` infrastructure in [apps#214](https://github.com/tjorim/apps/issues/214)
before this replaces its current Caddy Basic Auth policy.

For standalone use, copy `Caddyfile.example` to an ignored `Caddyfile`, set its
domain, and create an ignored `travel-auth.env` next to `compose.yaml`:

```dotenv
TRAVEL_AUTH_PASSWORD_HASH='$argon2id$v=19$m=65536,t=3,p=2$...'
TRAVEL_AUTH_SESSION_KEY='a-base64url-encoded-random-key-at-least-32-bytes'
TRAVEL_AUTH_SESSION_TTL=8h
TRAVEL_AUTH_COOKIE_SECURE=true
```

Generate the Argon2id PHC hash and a 32-byte signing key on the deployment
host without committing either value. Restrict the secret file (`chmod 600
travel-auth.env`). Start the standalone WIP stack with `docker compose up -d
--build`; only Caddy publishes ports.

The service verifies the existing central-infrastructure
`TRAVEL_PRIVATE_PASSWORD_HASH` variable too, so the production integration can
reuse the current Argon2id password hash instead of creating a second one.
For central production, `TRAVEL_AUTH_SESSION_KEY_FILE` points at the mounted
Docker secret; the signing key is therefore not placed in Caddy's or the
sidecar's environment.

### Verification once deployed

1. Public routes remain accessible.
2. A signed-out protected route redirects to `/login` and safely returns after
   a successful login.
3. The `travel_session` cookie is `HttpOnly`, `Secure`, `SameSite=Lax`, and
   short-lived; tampered or expired sessions are rejected.
4. Logout expires the cookie and private routes redirect to login again.

### Public-route safety review

Before deploying a change to a public static route, complete the short
[public-route safety check](docs/public-route-safety-check.md). It covers the
public/private file boundary, operational data and media metadata, and the
cache/indexing response needed if a page was accidentally exposed.

## Structure

- `dist/index.html` — travel-hub overview
- `dist/private/` — shared passport, insurance and emergency-document area (Caddy-protected)
- `dist/private/documents/` — document files committed to this private Git repository
- `dist/assets/travel/flight-map.js` — reusable, data-driven international flight map
- `dist/assets/travel/public-route-map.js` — reusable public route and places map
- `dist/assets/travel/document-list.js` — reusable private document list with in-app preview
- `dist/travel-offline-service-worker.js` — network-first worker that serves only explicitly saved private document copies while offline
- `dist/assets/travel/trip-summary.js` — reusable public story and private trip-header components
- `dist/assets/travel/trip-moments.js` — reusable public chronological story component
- `dist/assets/travel/trip-media.js` — reusable responsive public gallery and timeline-media component
- `media/<trip-slug>/original/` — Git LFS camera originals, deliberately kept outside the deployable archive
- `dist/<trip-slug>/public/media/` — selected metadata-free public derivatives and their manifest
- `dist/assets/travel/trip-renderers.js` — reusable trip-card, public timeline and private booking-status elements
- `dist/assets/travel/schemas/` — versioned JSON Schemas for public and private itinerary data
- `dist/exampleland-2054/index.html` — Taiwan public overview
- `dist/exampleland-2054/public/trip.json` — deliberately selected public Taiwan story data
- `dist/exampleland-2054/public/media/manifest.json` — selected public Taiwan photo metadata
- `dist/exampleland-2054/private/index.html` — Taiwan detailed itinerary, maps and bookings
- `dist/exampleland-2054/private/documents/` — Taiwan-specific protected document files and manifest
- `dist/exampleland-2054/private/trip.json` — protected Taiwan operational summary and booking status
- `dist/exampleland-2054/private/flight-route.json` — Taiwan flight-map data
- `dist/example-trip/` — a deliberately small, data-driven reference trip
- `auth/` — prepared server-side Argon2id login/session-gate component
- `compose.yaml` — standalone WIP Caddy and internal auth-service setup
- `Caddyfile.example` — Caddy static serving and protected-route auth check
The page has no build step or package dependencies. Public photos use committed,
responsive derivatives rather than external image URLs.

## Tracker API

`api/` is the separate FastAPI backend for the privacy-first tracker. It keeps
the static archive and its private documents untouched. The API stores only
owner-scoped trip data: exact and broad places, route stages, moments and
moment excerpts, and owner-authorized media uploads/imports copied into
application-controlled object storage (with owner-only EXIF GPS surfaced when
present). It does not perform continuous or automatic location tracking.

For local development, install the locked dependencies and run the tests:

```bash
cd api
uv sync --all-groups
uv run pytest
```

The production service requires `TRAVEL_DATABASE_URL` and a Keycloak/OIDC
validator configuration (`TRAVEL_OIDC_ISSUER_URL`, `TRAVEL_OIDC_JWKS_URL`, and
`TRAVEL_OIDC_AUDIENCE`). Until the identity infrastructure in apps#216 is
ready, local tests override the authenticated subject; production CRUD fails
closed when token validation is not configured. A development subject header is
accepted only when both `TRAVEL_ENVIRONMENT=development` and
`TRAVEL_ALLOW_DEVELOPMENT_SUBJECT_HEADER=true` are set. Apply schema changes with
`uv run alembic upgrade head`. Central deployment, PostgreSQL credentials,
backup coverage, and Caddy routing remain tracked in apps#215.

## Per-trip data contract

Each trip has two explicit content roots. Browser components fetch their JSON
directly from the matching static route; there is no publisher, CMS, API, or
runtime data service.

```
dist/<trip-slug>/
├── index.html                  public page
├── public/
│   └── trip.json               selected trip story
└── private/                    session-protected route
    ├── index.html              operational page
    ├── trip.json               operational summary and booking status
    ├── flight-route.json       protected route/map data, when needed
    └── documents/              protected files and manifest, when needed
```

`public/trip.json` is intentionally limited to the public story: a title,
broad dates, selected countries/cities or route stages, and optional selected
places, stories, photos, or post-trip highlights. It must not contain tickets,
confirmation numbers, exact accommodation addresses, live location, travel
party details, documents, insurance, passport information, or emergency
contacts.

`private/trip.json` holds protected operational context such as exact dates,
booking status, and itinerary details. Related private content belongs beside
it in separately named files when a reusable component needs a focused schema,
such as `flight-route.json` or a document `manifest.json`. Do not duplicate a
private value into public JSON merely to simplify a public page.

For a long-form public story, add a `moments` object to the same
`public/trip.json`. Each item has a stable `id`, a broad public `date`, `title`,
short `story`, and optional public `place`. Render it with
`travel-timeline-media`; its item IDs become shareable fragment URLs such as
`/exampleland-2054/timeline/#alishan-ochtend`. Public images are matched to those
IDs from the separate media manifest, so image metadata stays consistent in
the gallery and timeline.

## Public photo assets

Keep camera originals in `media/<trip-slug>/original/`, which is covered by
Git LFS and never deployed. Public, metadata-free derivatives and their
descriptive manifest live in `dist/<trip-slug>/public/media/`. The manifest
is the single source for public filenames, responsive widths, alt text,
captions, focal point, and optional timeline-moment association. See
[docs/media-assets.md](docs/media-assets.md) for the folder contract, the
EXIF-stripping preparation command, and gallery/timeline usage.

To add the optional public map, put a `routeMap` object in that same public
file and render it with `travel-public-route-map`. Its `mode` is deliberately
one of `full`, `city`, or `none`; a missing map is treated as `none`. Only add
places intentionally suitable for public display. In `city` mode, use a city
or region centre rather than a hotel, venue, trailhead, airport or current
position. The component always renders its ordered legs as visible text as
well as the static SVG map.

```html
<travel-public-route-map src="/my-trip/public/trip.json"></travel-public-route-map>
<script type="module" src="/assets/travel/public-route-map.js"></script>
```

`routeMap` contains public `stages`, selected `places` (`id`, `label`, broad
`coordinates`, and optional `stage`) and ordered `legs`. Never include booking
references, transport numbers, exact accommodation, unapproved stops, or
near-real-time location data.

For a new trip, create both JSON files first, then point the public
`travel-trip-story` and private `travel-trip-header` elements at their own
same-trip files. Add specialized components only when the data has its own
small schema.

## Schema-backed itinerary renderer

For a compact, fully data-driven itinerary, use the versioned schemas in
`dist/assets/travel/schemas/`. They model public identity, summary, timeline,
broad stays, locations and travel legs separately from protected exact stays
and bookings. Do not place booking references, confirmation links, exact
accommodation details, contact details, or document URLs in public JSON.

The public and private JSON formats are intentionally separate from the
lighter trip-story/header data consumed by `trip-summary.js`; this permits
specialized pages without forcing story-only pages to expose operational data.

Validate this renderer's public data against
`public-trip.schema.json` and protected data against `private-trip.schema.json`.
Its host needs `trip-renderers.js` and the relevant custom element:

```html
<travel-itinerary-timeline src="./public/trip.json"></travel-itinerary-timeline>
<!-- On the protected /private/ route only: -->
<travel-booking-status src="./trip.json"></travel-booking-status>
```

Use `<travel-trip-card src="/.../public/trip.json">` on an overview page.
`dist/example-trip/` is the complete copyable reference with a thin public
host and thin protected private host; it does not copy Taiwan-specific HTML.
