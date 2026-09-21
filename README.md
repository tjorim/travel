# Exampleland 2054 · Reisplan

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

Copy the contents of `dist/` to a directory owned by the web server, such as `/srv/exampleland-2054`. Use `Caddyfile.example` as the starting point for a site block. It protects `/private/` with Caddy's built-in HTTP Basic Authentication; the static public page needs no application server or database.

Generate the password hash on the VPS with `caddy hash-password --algorithm argon2id --plaintext 'choose-a-password'`, put that hash in the real Caddyfile, and keep the real file out of Git.

## Structure

- `dist/index.html` — travel-hub overview
- `dist/private/` — shared passport, insurance and emergency-document area (Caddy-protected)
- `dist/private/documents/` — document files committed to this private Git repository
- `dist/assets/travel/flight-map.js` — reusable, data-driven international flight map
- `dist/assets/travel/document-list.js` — reusable private document list with in-app preview
- `dist/assets/travel/trip-summary.js` — reusable public story and private trip-header components
- `dist/exampleland-2054/index.html` — Taiwan public overview
- `dist/exampleland-2054/public/trip.json` — deliberately selected public Taiwan story data
- `dist/exampleland-2054/private/index.html` — Taiwan detailed itinerary, maps and bookings
- `dist/exampleland-2054/private/documents/` — Taiwan-specific protected document files and manifest
- `dist/exampleland-2054/private/trip.json` — protected Taiwan operational summary and booking status
- `dist/exampleland-2054/private/flight-route.json` — Taiwan flight-map data
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

For a new trip, create both JSON files first, then point the public
`travel-trip-story` and private `travel-trip-header` elements at their own
same-trip files. Add specialized components only when the data has its own
small schema.
