# Repository Guidelines

## Project Structure & Module Organization

This is a Git-backed travel hub with a static archive and a small tracker API.
`dist/` remains the deployable archive root; `api/` is the FastAPI tracker
service and its Alembic migrations.

- `dist/index.html` is the public travel-hub landing page.
- `dist/<trip-slug>/` contains a trip's public page; Taiwan lives in
  `dist/exampleland-2054/`.
- `dist/private/` holds shared protected documents and emergency information.
- `dist/<trip-slug>/private/` holds protected itinerary and booking details.
- `dist/assets/travel/` contains reusable browser components such as
  `flight-map.js` and `document-list.js`.
- `api/app/` contains the tracker API; `api/alembic/` contains its migrations.
- `tracker/` is the React PWA shell, served only below `/tracker/`.
- `PLAN.md` is the ordered backlog; `CHANGELOG.md` records completed changes.

## Build, Test, and Development Commands

The static archive has no package dependencies or build step. Serve it locally
with:

```bash
python3 -m http.server 8080 --directory dist
```

Open `http://localhost:8080`. Private routes are only password-protected by
Caddy in deployment, so local serving intentionally does not test auth. Before
committing JavaScript or JSON changes, run:

```bash
node --check dist/assets/travel/flight-map.js
jq empty dist/exampleland-2054/private/flight-route.json
git diff --check
```

Validate `Caddyfile.example` with a Caddy container when its routing changes.

For tracker API work, use the locked Python environment:

```bash
cd api
uv run pytest
uv run ruff check .
```

For tracker PWA work, use the repository's Vite+ Node version:

```bash
cd tracker
vp env exec --node 24.14.0 pnpm install --frozen-lockfile
vp env exec --node 24.14.0 pnpm build
```

## Coding Style & Naming Conventions

Use semantic HTML, modern browser JavaScript, and CSS custom properties. Keep
the site dependency-free unless a clear need is documented in `PLAN.md`.
Use two-space indentation in HTML, CSS, JSON, and JavaScript. Name trip folders
and data files with lowercase kebab case, for example
`dist/japan-2027/private/flight-route.json`. Reusable custom elements use the
`travel-` prefix.

Never place operational data on public routes. Keep documents in their private
directory with a matching `manifest.json`; do not commit passwords, PINs,
recovery codes, or payment-card details.

Tracker endpoints must enforce ownership from the authenticated subject and
must not expose it through published-trip responses. Do not add GPS capture,
precise addresses, media uploads, or automatic archive migration without an
explicit product/privacy decision.

## Commit & Pull Request Guidelines

Follow the existing short, imperative, Title Case commit style, for example
`Add reusable travel maps and document previews`. Keep each commit focused.
Reference a relevant GitHub issue for substantive work and update `PLAN.md`
when its order changes. Pull requests should state the affected public/private
routes, include screenshots for visual changes, and note the manual checks run.
