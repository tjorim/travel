# Repository Guidelines

## Project Structure & Module Organization

This is the Travel application: a FastAPI backend and a React PWA. Trips,
documents and media are created in the application, never committed to Git.
Use synthetic fixtures and keep private review evidence outside Git. Follow
`docs/source-privacy.md` when reviewing examples and assets.

- `backend/app/` contains the application service and API; `backend/alembic/`
  contains its migrations.
- `frontend/` is the React source for the owner PWA below `/admin/` and the
  public `/trips/` and unlisted `/share/` visitor views.
- `PLAN.md` is the ordered backlog; `CHANGELOG.md` records completed changes.

## Build, Test, and Development Commands

Validate `Caddyfile.example` when routing changes and keep it aligned with the
Travel block in `tjorim/apps` `infra/Caddyfile`.

For backend API work, use the locked Python environment:

```bash
cd backend
uv sync --all-groups --frozen
uv run pytest
uv run ruff check .
uv run ty check .
# Run migration checks against a local PostgreSQL database.
TRAVEL_DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/travel \
  uv run alembic upgrade head
TRAVEL_DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/travel \
  uv run alembic downgrade base
```

For frontend work, install the Node version in `frontend/.node-version` and
run pnpm directly (the package pins pnpm 12.16.1):

```bash
cd frontend
test "$(node --version)" = "v$(cat .node-version)"
pnpm install --frozen-lockfile
pnpm lint
pnpm format:check
pnpm build
pnpm e2e
```

`pnpm e2e` runs the Playwright smoke and axe checks in `frontend/e2e/` against
the Vite dev server with the API mocked, so it needs no session or database.
Run `pnpm exec playwright install chromium` once; extend `e2e/mock-api.ts` when
a screen under test needs more data.

Vitest suites mock the API with MSW (`frontend/src/mocks/server.ts`, started in
`src/test-setup.ts`): declare a test's routes with `server.use(http.get(...))`.
A request nobody handles fails the test. Older suites still stub `fetch`; move
them over when you touch them.

The frontend's API types are generated, never written by hand. `frontend/openapi.json` is a
committed snapshot of the backend's OpenAPI document (`backend/app/openapi_export.py`) and
`frontend/src/api-schema.ts` is generated from it with the pinned `openapi-typescript`. After
changing a response model or an endpoint in `backend/`, run `pnpm api:generate` in `frontend/`
(it needs `uv`) and commit both files. `pnpm typecheck` runs `pnpm api:check` and fails when
`api-schema.ts` is stale; the backend test `test_openapi_snapshot` fails when `openapi.json` is stale.
Name a generated record for the screens in `frontend/src/api-types.ts`; do not declare an API
record type in the frontend. Every JSON endpoint needs a `response_model` (a test enforces it),
and a response model derives from `ResponseModel` in `backend/app/schemas.py` so a field with a
default is required in the generated type. `python-travel` is published on its own and keeps a
small hand-written copy of the wire models it reads; `backend/tests/test_python_client_models.py`
holds that copy to the OpenAPI schema instead of generating it.

GitHub Actions runs each affected component's checks on pull requests and all
of them on every push to `main`.

## Coding Style & Naming Conventions

Use two-space indentation in TypeScript, CSS and JSON, and match the
surrounding code. Keep Python to the Ruff configuration in
`backend/pyproject.toml`.

Check the shadcn registry and Base UI for a supported component or variant
before writing a custom control or composition, and record a custom one that
stays, with its reason, in `docs/ui-components.md`. Generate new UI primitives
on demand from `frontend/` with
`pnpm exec shadcn add <component> --yes`, then own and restyle the
copied source. `components.json` pins Base UI (`base-nova`), Lucide and
Tailwind v4. Initial setup used `pnpm dlx shadcn@4.21.0 init --base base
--preset nova --yes --no-monorepo --no-reinstall`. Do not bulk-generate or
overwrite app controls without reviewing their behaviour. Use the existing
`cn` package; `src/lib/utils.ts` re-exports it for generated imports. Map
semantic colours to Travel tokens and keep all four lint rules green.
See `docs/ui-components.md` for existing controls’ keep/replace decisions.

Use Tailwind utilities for new frontend styling and `cn` for conditional
utility classes. Keep reusable design values in named Tailwind theme tokens.
Tailwind's base layer holds document and form defaults;
`frontend/src/styles.css` holds only sanitized Markdown styling. Use Base UI
Button, Input, Checkbox, Collapsible and Progress for matching controls; render
textareas through Base UI Field.Control. Label, describe and validate controls
with the Base UI-backed `Field`, `FieldLabel`, `FieldError`, `FieldSet` and
`FieldLegend` components in `frontend/src/ui/field.tsx` instead of raw
`<label>` and `<fieldset>`. Offer free-text suggestions with `SuggestInput`
(Base UI Autocomplete), never `<datalist>`. Shared record editors use Base UI
Dialog and Alert Dialog with guarded dismissal and focus return.
The frontend lint command checks utility classes without a legacy-class
allowlist.
Use Oxfmt for frontend formatting with `pnpm format`, and run
`pnpm format:check` before submitting changes.

Operational data (stays, routes, visits, tasks, documents) stays
owner-only; visitor views receive only fields an owner scope explicitly
selects. Complete `docs/publication-safety-check.md` before publishing. Do not
commit passwords, PINs, recovery codes, or payment-card details.

Stored objects follow `docs/object-storage.md`: write before the row commits,
never rewrite a referenced key, delete only after `purge_pending` commits and
under `lock_object_deletion`, and no dot-entries. The apps backup depends on
these rules; keep new file-backed features inside them.

Owner API endpoints must enforce ownership from the authenticated subject and
must not expose it through published-trip responses. GPS capture is approved only
for decision 244. Do not add further GPS capture,
precise addresses, media uploads, or automatic archive migration without an
explicit product/privacy decision.

## Commit & Pull Request Guidelines

Follow the existing short, imperative, Title Case commit style, for example
`Add reusable travel maps and document previews`. Keep each commit focused.
Reference a relevant GitHub issue for substantive work and update `PLAN.md`
when its order changes. Pull requests should state the affected public/private
routes, describe visual checks, and note the manual checks run.

## Releases

Releases use CalVer, `YYYY.M.MICRO` (`MICRO` counts releases within a month), tagged `vYYYY.M.MICRO`.
`VERSION` is the single source of truth; the files listed in `release.config.json` (backend and MCP
version strings, the Home Assistant manifest and diagnostics, `frontend/package.json`, the integration
README) are derived from it and checked by CI. `python-travel` (PyPI) uses the same CalVer: its `pyproject.toml`,
the three `uv.lock` entries and the `python-travel==` pin in the manifest are in `release.config.json`, and
`release.yml` publishes it to PyPI (environment `pypi`, trusted publishing) before drafting the HACS archive.

1. Add entries under `## [Unreleased]` in `CHANGELOG.md` while working (`### Added`, `### Changed`,
   `### Fixed`, `### Removed`). Put backend, infrastructure, CI and dependency changes under `### Internal`:
   apps hide that heading from users. Prefix a bullet with `**Web:**` (any scope in `release.config.json`)
   when it only applies to one client. `node scripts/release.mjs export --audience app --platform web`
   prints what an app should show as JSON.
2. `node scripts/release.mjs bump` writes the next version everywhere and turns `[Unreleased]` into the
   dated release section. Review the diff, open the release PR and merge it.
3. Tag the merge commit `vYYYY.M.MICRO` and push the tag. `release.yml` re-checks the tag against
   `VERSION` and the changelog, builds and validates `travel.zip`, and attaches it to a **draft** GitHub
   release with the changelog section as notes.
4. Download and test the attached archive and dependency installation (see `home-assistant/README.md`),
   then publish the draft.

`node scripts/release.mjs check` runs in CI on every pull request.

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

GitHub issues are living documents: do not add comments to them. Record
clarifications, decisions, new sub-issue links and corrections by editing the
issue body (read it first, keep the original text, and add or adjust a clearly
headed section). This applies to closed issues too.

## Interface messages

Frontend application copy belongs in `frontend/messages/nl.json` and `en.json`.
Use typed whole-message functions from `src/paraglide/messages.js` during render
with `useLocale()`; retain message descriptors/functions for stored notices.
Never translate authored content or match server prose. `pnpm paraglide:compile`
generates ignored code before check/test/build. Use selected-locale formatting
from `src/locale.tsx` and the configured `dayjs.ts`; preserve ISO dates, timezones
and numeric input/payload values. Store message functions/descriptors for async
feedback and serializable message codes in browser history; never store a translated UI snapshot. Unknown API errors
use a translated operation fallback, never server prose or submitted input. New
application copy must pass `pnpm locale:audit`, `pnpm typecheck` and `pnpm test` in
addition to lint/format/build. Review both locales/themes, narrow layouts, accessible
names, and dirty editor/upload/focus preservation. See
`docs/interface-translations.md` for the repeatable audit and exclusions, and
`docs/decisions/281-interface-translations.md` for translation decisions and
source audit coverage.

## UI dependency maintenance

Follow [docs/ui-maintenance.md](docs/ui-maintenance.md) for Base UI/runtime updates and the pinned shadcn CLI, registry comparisons and review records. Run `pnpm ui:check` from `frontend/` after changing shared UI. Dependabot does not update owned component source; preserve the documented customisations and validate interactions and bundle budgets.

Application UI imports use `@/ui/<component>`. Direct Base UI subpath imports belong in inventoried UI adapters or exact documented composition exceptions. `pnpm ui:check` enforces the policy; `pnpm ui:test` tests it. Keep styles and application behaviour when aligning imports.

## Live location exception (#244, 2026-11-09)

The owner explicitly approved exact live-track storage and current-only audience
sharing. Earlier blanket no-GPS-history/live-location statements are superseded
only by [decision 244](docs/decisions/244-live-location-tracks.md).
Tracks stay owner-only until explicit deletion; freshness expiry preserves them.
Review each enabled audience and its delivered precision before sharing. Live
coordinates and tracks are excluded from PDF, Atom and ordinary trip exports;
owner track export is a separate deliberate download. Database and HA backups
may retain deleted history until their independent retention expires.
