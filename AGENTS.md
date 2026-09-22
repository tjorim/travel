# Repository Guidelines

## Project Structure & Module Organization

This is a Git-backed travel hub with a static archive and an application backend.
`dist/` remains the deployable archive root; `backend/` contains the FastAPI
service and its Alembic migrations.

- `dist/index.html` is the public travel-hub landing page.
- `dist/<trip-slug>/` contains a trip's public page; Taiwan lives in
  `dist/exampleland-2054/`.
- `dist/private/` holds shared protected documents and emergency information.
- `dist/<trip-slug>/private/` holds protected itinerary and booking details.
- `dist/assets/travel/` contains reusable browser components such as
  `travel-map.js` and `document-list.js`.
- `backend/app/` contains the application service and API; `backend/alembic/`
  contains its migrations.
- `frontend/` is the React source for the owner PWA below `/admin/` and the
  public `/trips/` and unlisted `/share/` visitor views.
- `PLAN.md` is the ordered backlog; `CHANGELOG.md` records completed changes.

## Build, Test, and Development Commands

The static archive has no package dependencies or build step. Serve it locally
with:

```bash
python3 -m http.server 8080 --directory dist
```

Open `http://localhost:8080`. Private routes are only password-protected by
Caddy in deployment, so local serving intentionally does not test auth. Before
committing static archive changes, run the checks against every tracked file
they cover:

```bash
git ls-files -z -- 'dist/assets/travel/*.js' | xargs -0 -r -n 1 node --check
git ls-files -z -- 'dist/*.json' 'dist/**/*.json' | xargs -0 -r -n 1 jq empty
git diff --check
```

Validate `Caddyfile.example` with a Caddy container when its routing changes.

For tracker API work, use the locked Python environment:

```bash
cd backend
uv sync --all-groups --frozen
uv run pytest
uv run ruff check .
# Run migration checks against a local PostgreSQL database.
TRAVEL_DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/travel \
  uv run alembic upgrade head
TRAVEL_DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/travel \
  uv run alembic downgrade base
```

For the Go authentication service, run:

```bash
cd auth
go vet ./...
go build ./...
go test ./...
```

For frontend work, use the repository's pinned Node version:

```bash
cd frontend
vp env exec --node "$(cat .node-version)" pnpm install --frozen-lockfile
vp env exec --node "$(cat .node-version)" pnpm build
```

GitHub Actions runs each affected component's checks on pull requests and all
of them on every push to `main`.

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

## Deferred work and repo scope

If a gap fits inside the change already in progress — same repository,
fixable now, nothing else it depends on is missing — fix it there directly
instead of deferring it. Opening an issue for something you could just do
is its own way of leaving it undone. Open an issue only for what genuinely
doesn't fit: it belongs in a different repository, it depends on work that
doesn't exist yet, or a product/privacy decision deliberately put it out of
scope.

When a change surfaces work that is legitimately out of scope — even when
the reason is a deliberate boundary already documented elsewhere, like
`PLAN.md`'s v1 "application-only" vs v2 "VPS cutover" split — open a
concrete GitHub issue for it before considering the change done. A sentence
in a README, docstring, or commit message explaining why something was left
out is not the same as something that will actually happen; it must also be
tracked. Check first whether an existing issue already covers it (for
example, PLAN.md's "Coordination" notes and each issue's "Dependencies"
section usually point to the right one) before opening a duplicate.

Route each issue to the repository that owns the work, not reflexively to
this one: `tjorim/travel` owns the application — its API, PWA, and static
archive. `tjorim/apps` owns shared VPS infrastructure — deployment,
container/service wiring, cron/systemd scheduling, and backup/restore. Work
that only runs on the VPS (a scheduled job, storage provisioning, Caddy or
Keycloak wiring) belongs in `tjorim/apps` even when the function or code it
invokes lives here; link back to the originating `tjorim/travel` issue or PR
for context instead of duplicating that context into the new issue.
