# Travel

Static travel hub. Exampleland 2054 is its first trip at `/exampleland-2054/`, with a detailed itinerary at `/exampleland-2054/private/`. Shared documents and emergency details live at `/private/`. Future trips can follow the same `dist/<trip-slug>/` layout.

- [PLAN.md](PLAN.md) — ordered work and TODOs
- [CHANGELOG.md](CHANGELOG.md) — implemented changes

## Run locally

Serve the `dist` directory with any static web server.

For example:

```bash
python3 -m http.server 8080 --directory dist
```

Then open `http://localhost:8080`.

## VPS deployment

Copy the contents of `dist/` to a directory owned by the web server, such as `/srv/travel`. Use `Caddyfile.example` as the starting point for a site block. It protects `/private/` and every `/<trip>/private/` route with Caddy's built-in HTTP Basic Authentication; the static public page needs no application server or database.

Generate the password hash on the VPS with `caddy hash-password --algorithm argon2id --plaintext 'choose-a-password'`, put that hash in the real Caddyfile, and keep the real file out of Git.

## Structure

- `dist/index.html` — travel-hub overview
- `dist/private/` — shared passport, insurance and emergency-document area (Caddy-protected)
- `dist/private/documents/` — document files committed to this private Git repository
- `dist/assets/travel/flight-map.js` — reusable, data-driven international flight map
- `dist/assets/travel/document-list.js` — reusable private document list with in-app preview
- `dist/assets/travel/trip-summary.js` — reusable public story and private trip-header components
- `dist/assets/travel/trip-moments.js` — reusable public chronological story component
- `dist/assets/travel/trip-renderers.js` — reusable trip-card, public timeline and private booking-status elements
- `dist/assets/travel/schemas/` — versioned JSON Schemas for public and private itinerary data
- `dist/exampleland-2054/index.html` — Taiwan public overview
- `dist/exampleland-2054/public/trip.json` — deliberately selected public Taiwan story data
- `dist/exampleland-2054/private/index.html` — Taiwan detailed itinerary, maps and bookings
- `dist/exampleland-2054/private/documents/` — Taiwan-specific protected document files and manifest
- `dist/exampleland-2054/private/trip.json` — protected Taiwan operational summary and booking status
- `dist/exampleland-2054/private/flight-route.json` — Taiwan flight-map data
- `dist/example-trip/` — a deliberately small, data-driven reference trip
- `Caddyfile.example` — static VPS serving with a protected private section
The page has no build step or package dependencies. One travel photograph is loaded from an external URL; all other visuals are embedded directly in the HTML.

## Per-trip data contract

Each trip has two explicit content roots. Browser components fetch their JSON
directly from the matching static route; there is no publisher, CMS, API, or
runtime data service.

```
dist/<trip-slug>/
├── index.html                  public page
├── public/
│   └── trip.json               selected trip story
└── private/                    Caddy-protected route
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
short `story`, optional `place`, and optional public `photos` (`src`, `alt`,
and `caption`). Render it with `travel-moment-timeline`; its item IDs become
shareable fragment URLs such as `/exampleland-2054/timeline/#alishan-ochtend`.

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
