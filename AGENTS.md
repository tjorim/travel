# Repository Guidelines

## Project Structure & Module Organization

This is the Travel application: a FastAPI backend and a React PWA. Trips,
documents and media are created in the application, never committed to Git.

- `dist/` is the retired static archive. It is not deployed and takes no new
  content; `dist/exampleland-2054/private/app-import.json` is its extracted trip for
  the owner-run `app.archive_import` (#40), after which `dist/` is removed.
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

Open `http://localhost:8080`. The archive is no longer deployed; production
Caddy serves only the application routes, so never add a route that publishes
`dist/` again. Before committing static archive changes, run the checks against
every tracked file they cover:

```bash
git ls-files -z -- 'dist/assets/travel/*.js' | xargs -0 -r -n 1 node --check
git ls-files -z -- 'dist/*.json' 'dist/**/*.json' | xargs -0 -r -n 1 jq empty
git diff --check
```

Validate `Caddyfile.example` with a Caddy container when its routing changes,
and keep it in step with the Travel block in `tjorim/apps` `infra/Caddyfile`.

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

For frontend work, install the Node version in `frontend/.node-version` and
run pnpm directly (CI uses pnpm 10.28.2):

```bash
cd frontend
test "$(node --version)" = "v$(cat .node-version)"
pnpm install --frozen-lockfile
pnpm lint
pnpm format:check
pnpm build
```

GitHub Actions runs each affected component's checks on pull requests and all
of them on every push to `main`.

## Coding Style & Naming Conventions

Use two-space indentation in TypeScript, CSS and JSON, and match the
surrounding code. Keep Python to the Ruff configuration in
`backend/pyproject.toml`.

Use Tailwind utilities for new frontend styling and `cn` for conditional
utility classes. Existing rules in `frontend/src/styles.css` remain while
affected views migrate; do not extend that file for new styling. The frontend
lint command checks new utility classes and permits only legacy classes
defined in that stylesheet. The existing native `RecordDialog` remains until
the dialog migration in #264; use Radix Dialog and Alert Dialog for that work
while preserving its current dismissal and focus behavior.
Use Oxfmt for frontend formatting with `pnpm format`, and run
`pnpm format:check` before submitting changes.

Operational data (stays, routes, visits, tasks, documents) stays
owner-only; visitor views receive only fields an owner scope explicitly
selects. Complete `docs/publication-safety-check.md` before publishing. Do not
commit passwords, PINs, recovery codes, or payment-card details.

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
