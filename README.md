# Travel

The repository contains a Git-backed static archive and a new Travel
application. Exampleland 2054 remains in the archive under `dist/`. The application
launches with its own data and live routes; it does not import archive content
or preserve archive URLs. The old static trip goes offline at launch while its
files remain in the repository for separate #40 work. Future trips are created
in the application.

- [PLAN.md](PLAN.md) — ordered work and TODOs
- [CHANGELOG.md](CHANGELOG.md) — implemented changes
- [Privacy, sharing and offline policy](docs/decisions/36-privacy-sharing-offline-policy.md) — v1 access, named-share-link, and redaction contract
- [Canonical content and publication model](docs/decisions/37-canonical-content-and-publication-model.md) — application data, storage, and projection contract
- [Live browser route and projection contract](docs/decisions/103-live-browser-route-contract.md) — owner, public, and unlisted browser routes and delivery safeguards
- [Fresh launch route boundary](docs/decisions/101-legacy-route-transition.md) — route ownership without archive import or URL aliases

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

- `frontend/` — React source for the owner `/admin/` PWA and live public and unlisted trip views
- `frontend/MAP-PROVIDER.md` — app map provider, attribution, privacy and failure policy
- `backend/` — application service, FastAPI routes and future owner MCP workflows
- `dist/index.html` — travel-hub overview
- `dist/private/` — shared passport, insurance and emergency-document area (Caddy-protected)
- `dist/private/documents/` — document files committed to this private Git repository
- `dist/assets/travel/travel-map.js` — shared MapLibre renderer for public and private GeoJSON routes
- `dist/assets/travel/MAP-PROVIDER.md` — map provider, attribution, privacy and failure policy
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
- `dist/exampleland-2054/public/route-map.geojson` — broad Taiwan public route
- `dist/exampleland-2054/private/flight-map.geojson` and `local-route.geojson` — protected flight and local routes
- `dist/example-trip/` — a deliberately small, data-driven reference trip
- `auth/` — prepared server-side Argon2id login/session-gate component
- `compose.yaml` — standalone WIP Caddy and internal auth-service setup
- `Caddyfile.example` — Caddy static serving and protected-route auth check
The page has no build step or package dependencies. Public photos use committed,
responsive derivatives rather than external image URLs.

## Application backend

`backend/` contains the FastAPI service for the Travel application. It keeps
the static archive and its private documents untouched. The API stores only
owner-scoped trip data: exact and broad places, route stages, moments and
moment excerpts, and owner-authorized media uploads/imports copied into
application-controlled object storage (with owner-only EXIF GPS surfaced when
present). It does not perform continuous or automatic location tracking.

For local development, install the locked dependencies and run the tests:

```bash
cd backend
uv sync --all-groups
uv run pytest
```

The production service requires `TRAVEL_DATABASE_URL` and a Keycloak/OIDC
validator configuration (`TRAVEL_OIDC_ISSUER_URL`, `TRAVEL_OIDC_JWKS_URL`, and
`TRAVEL_OIDC_AUDIENCE`), provided in production by the `travel` Keycloak realm
from apps#216. Local tests override the authenticated subject; CRUD fails
closed when token validation is not configured. A development subject header is
accepted only when both `TRAVEL_ENVIRONMENT=development` and
`TRAVEL_ALLOW_DEVELOPMENT_SUBJECT_HEADER=true` are set. Apply schema changes with
`uv run alembic upgrade head`. Central deployment, PostgreSQL credentials,
backup coverage, media storage and Caddy routing live in the `apps` repository
(apps#215, apps#219 and apps#220).

## Per-trip data contract

Each trip has two explicit content roots. Browser components fetch their JSON
directly from the matching static route; there is no publisher, CMS, API, or
runtime data service.

```
dist/<trip-slug>/
├── index.html                  public page
├── public/
│   ├── trip.json               selected trip story
│   └── route-map.geojson       selected broad route, when needed
└── private/                    session-protected route
    ├── index.html              operational page
    ├── trip.json               operational summary and booking status
    ├── flight-map.geojson      protected flight route, when needed
    ├── local-route.geojson     protected local route, when needed
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
such as `flight-map.geojson` or a document `manifest.json`. Do not duplicate a
private value into public JSON merely to simplify a public page.

For a long-form public story, add a `moments` object to the same
`public/trip.json`. Each item has a stable `id`, a broad public `date`, `title`,
short `story`, and optional public `place`. Render it with
`travel-timeline-media`; its item IDs become shareable fragment URLs such as
`/exampleland-2054/timeline/#alishan-ochtend`. Public images are matched to those
IDs from the separate media manifest, so image metadata stays consistent in
the gallery and timeline.

## Static archive photo assets

This section describes the retained `dist/` archive for later migration under
#40. New Travel app photos and derivatives are managed in the owner PWA and API;
no new media is prepared into Git.

Keep camera originals in `media/<trip-slug>/original/`, which is covered by
Git LFS and never deployed. Public, metadata-free derivatives and their
descriptive manifest live in `dist/<trip-slug>/public/media/`. The manifest
is the single source for public filenames, responsive widths, alt text,
captions, focal point, and optional timeline-moment association. See
[docs/media-assets.md](docs/media-assets.md) for the retained folder contract
and gallery/timeline usage.

To add an optional public map, create a separate versioned GeoJSON file under
the trip's public directory using
`dist/assets/travel/schemas/map-data.schema.json`. Set `audience` to `public`
and use only deliberately selected city or region coordinates. Never include
an exact stay, venue, trailhead or current position. The shared component
renders an interactive geographic map, keyboard-operable stops and a route in
words. Include fallback text for browsers without JavaScript or WebGL.

```html
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@6.10.0/dist/maplibre-gl.css">
<link rel="stylesheet" href="/assets/travel/travel-map.css">
<travel-map src="/my-trip/public/route-map.geojson">
  <p class="travel-map-fallback">Follow the selected route in words here.</p>
</travel-map>
<script type="module" src="/assets/travel/travel-map.js"></script>
```

The GeoJSON contains longitude/latitude points and deliberately authored route
lines. Keep public and private files separate. Never include booking references,
transport numbers, exact accommodation, unapproved stops or near-real-time
location data in the public file. See `dist/assets/travel/MAP-PROVIDER.md` before
selecting or changing the map style or tile provider.

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
