# Exampleland 2054 · Reisplan

Static travel hub. Exampleland 2054 is its first trip at `/exampleland-2054/`, with a detailed itinerary at `/exampleland-2054/private/`. Future trips can follow the same `dist/<trip-slug>/` layout.

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
- `dist/exampleland-2054/index.html` — Taiwan public overview
- `dist/exampleland-2054/private/index.html` — Taiwan detailed itinerary, map and bookings
- `Caddyfile.example` — static VPS serving with a protected private section
The page has no build step or package dependencies. One travel photograph is loaded from an external URL; all other visuals are embedded directly in the HTML.
