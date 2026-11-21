# AGENTS.md

## Project overview

Travel is a private trip planner and travel journal: a React 19 + Vite + TypeScript 7 PWA (`frontend/`) for the owner
below `/admin/` and for the public `/trips/` and unlisted `/share/` visitor views, a FastAPI + SQLAlchemy backend
(`backend/`) with an owner-authenticated MCP server whose OpenAPI document drives the frontend's generated API types, a
Home Assistant integration (`custom_components/travel/`, `home-assistant/`) and the `python-travel` client library.
Trips, documents and media are created in the application, never committed to Git. Use synthetic fixtures and keep
private review evidence outside Git; follow `docs/source-privacy.md` when reviewing examples and assets. Toolchain
versions live in `frontend/.node-version`, the `packageManager` field of `frontend/package.json` and
`backend/pyproject.toml`; see `docs/toolchain.md`.

## Repository layout

- `frontend/` contains the React source (`src/`, unit tests in `tests/`, Playwright specs in `e2e/`, translations in
  `messages/`). `src/` is `app/` (providers, router, layout), `features/<domain>/`, `components/` (with `components/ui/`),
  `hooks/`, `lib/`, `i18n/`, `mocks/` and `styles/`, plus the two entry points `main.tsx` (owner app) and
  `visitor-main.tsx` (public and share app); `tests/` mirrors `src/`. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
  for the rules and where new code goes
- `backend/` contains the FastAPI service (`app/`, `alembic/`, `tests/`)
- `custom_components/travel/` is the Home Assistant integration, `home-assistant/` its tests and packaging, and
  `python-travel/` the PyPI client library
- `docs/` holds contracts, decisions and maintenance guides; `scripts/` the release tooling
- `compose.yaml` and `Caddyfile.example` are the local stack (Caddy, the API and PostgreSQL); validate
  `Caddyfile.example` when routing changes and keep it aligned with the Travel block in `tjorim/apps`
  `infra/Caddyfile`
- `PLAN.md` is the ordered backlog; `CHANGELOG.md` records completed changes

### Source of truth

- `VERSION` (repo root) for the app version, see "Release"
- `backend/` for API shapes: `frontend/openapi.json` is the committed OpenAPI document
  (`uv run python -m app.openapi_export`), `frontend/src/api-schema/` is generated from it by Orval and
  `frontend/src/api-types.ts` is the one place screens import API types from
- `frontend/messages/` for translation content

## Commands

### Frontend (`cd frontend`)

```bash
test "$(node --version)" = "v$(cat .node-version)"
pnpm install --frozen-lockfile
pnpm dev                 # proxies /api to a backend on localhost:8000 (see the README for the dev auth bypass)
pnpm typecheck           # paraglide:compile + api:check + tsc -b --noEmit
pnpm lint
pnpm format              # rewrites files in place
pnpm format:check        # what CI runs
pnpm format:repo         # same for ../.github, ../scripts and the root JSON files (format:repo:check in CI)
pnpm test                # Vitest (MSW-mocked API); test:watch for watch mode
pnpm test:e2e            # Playwright smoke and axe checks against the Vite dev server with the API mocked
pnpm test:e2e:offline    # builds, then runs the service-worker/offline specs
pnpm build
pnpm bundle:check        # bundle budgets (bundle:report prints them, bundle:test tests the script)
pnpm locale:audit        # interface strings and catalogues
pnpm check-message-parity
pnpm paraglide:compile   # regenerates src/paraglide (git-ignored)
pnpm api:generate        # rewrites openapi.json (needs uv) and src/api-schema/
pnpm api:check           # fails when src/api-schema/ is stale against openapi.json
pnpm ui:check            # UI maintenance inventory (ui:test, ui:usage, ui:upstream, ui:diff, ui:record)
pnpm test:compatibility  # native-React vs Redact runtime checks (:runtime, :browsers)
```

Run `pnpm exec playwright install chromium` once before the e2e specs; extend `e2e/mock-api.ts` when a screen under
test needs more data.

### Backend (`cd backend`)

```bash
uv sync --all-groups --locked
uv run uvicorn app.main:app --reload     # TRAVEL_ENVIRONMENT=development; SQLite file built by app.db.dev_schema
uv run pytest
uv run ruff check .
uv run ruff format --check .             # ruff format . to rewrite
uv run ty check .
uv run alembic upgrade head              # PostgreSQL; alembic check verifies migrations match the models
uv run python -m app.openapi_export      # rewrites ../frontend/openapi.json
uv run python -m app.db.dev_schema          # SQLite dev database from the models (--reset rebuilds it)
```

Migration checks need a local PostgreSQL database:
`TRAVEL_DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/travel uv run alembic upgrade head` and
`... alembic downgrade base`.

## Conventions

### Code style

Use two-space indentation in TypeScript, CSS and JSON, and match the surrounding code. Keep Python to the Ruff
configuration in `backend/pyproject.toml`. Use Oxfmt for frontend formatting with `pnpm format`, and run
`pnpm format:check` before submitting changes.

### Styling and UI

Check the shadcn registry and Base UI for a supported component or variant before writing a custom control or
composition, and record a custom one that stays, with its reason, in `docs/ui-components.md`. Generate new UI primitives
on demand from `frontend/` with `pnpm exec shadcn add <component> --yes`, then own and restyle the copied source.
`components.json` pins Base UI (`base-nova`), Lucide and Tailwind v4. Initial setup used
`pnpm dlx shadcn@4.21.0 init --base base --preset nova --yes --no-monorepo --no-reinstall`. Do not bulk-generate or
overwrite app controls without reviewing their behaviour. Use the existing `cn` package; `src/lib/utils.ts` re-exports
it for generated imports. Map semantic colours to Travel tokens and keep all four shadcn lint rules green. See
`docs/ui-components.md` for existing controls' keep/replace decisions.

Use Tailwind utilities for new frontend styling and `cn` for conditional utility classes. Keep reusable design values
in named Tailwind theme tokens. Tailwind's base layer holds document and form defaults; `frontend/src/styles/app.css` holds
only sanitized Markdown styling. Use Base UI Button, Input, Checkbox, Collapsible and Progress for matching controls;
render textareas through Base UI Field.Control. Label, describe and validate controls with the Base UI-backed `Field`,
`FieldLabel`, `FieldError`, `FieldSet` and `FieldLegend` components in `frontend/src/components/ui/field.tsx` instead of raw
`<label>` and `<fieldset>`. Offer free-text suggestions with `SuggestInput` (Base UI Autocomplete), never `<datalist>`.
Shared record editors use Base UI Dialog and Alert Dialog with guarded dismissal and focus return. The frontend lint
command checks utility classes without a legacy-class allowlist.

### UI dependency maintenance

Follow [docs/ui-maintenance.md](docs/ui-maintenance.md) for Base UI/runtime updates and the pinned shadcn CLI, registry
comparisons and review records. Run `pnpm ui:check` from `frontend/` after changing shared UI. Renovate does not update
owned component source; preserve the documented customisations and validate interactions and bundle budgets.

Application UI imports use `@/components/ui/<component>`. Direct Base UI subpath imports belong in inventoried UI adapters or exact
documented composition exceptions. `pnpm ui:check` enforces the policy; `pnpm ui:test` tests it. Keep styles and
application behaviour when aligning imports.

### Tests

Vitest suites mock the API with MSW (`frontend/src/mocks/server.ts`, started in `frontend/tests/setup.ts`): declare a
test's routes with `server.use(http.get(...))`. A request nobody handles fails the test. Older suites still stub
`fetch`; move them over when you touch them. Suites that need a DOM opt in with a `// @vitest-environment happy-dom`
docblock. Playwright specs live in `frontend/e2e/`; backend tests in `backend/tests/`.

### Internationalisation

Frontend application copy belongs in `frontend/messages/nl.json` and `en.json`. Use typed whole-message functions from
`src/paraglide/messages.js` during render with `useLocale()`; retain message descriptors/functions for stored notices.
Never translate authored content or match server prose. `pnpm paraglide:compile` generates ignored code before
check/test/build. Use selected-locale formatting from `src/i18n/locale.tsx` and the configured `dayjs.ts`; preserve ISO
dates, timezones and numeric input/payload values. Store message functions/descriptors for async feedback and
serializable message codes in browser history; never store a translated UI snapshot. Unknown API errors use a
translated operation fallback, never server prose or submitted input. New application copy must pass
`pnpm locale:audit`, `pnpm typecheck` and `pnpm test` in addition to lint/format/build. Review both locales/themes,
narrow layouts, accessible names, and dirty editor/upload/focus preservation. See `docs/interface-translations.md` for
the repeatable audit and exclusions, and `docs/decisions/281-interface-translations.md` for translation decisions and
source audit coverage.

### Privacy and data

Operational data (stays, routes, visits, tasks, documents) stays owner-only; visitor views receive only fields an owner
scope explicitly selects. Complete `docs/publication-safety-check.md` before publishing. Do not commit passwords, PINs,
recovery codes, or payment-card details.

Stored objects follow `docs/object-storage.md`: write before the row commits, never rewrite a referenced key, delete
only after `purge_pending` commits and under `lock_object_deletion`, and no dot-entries. The apps backup depends on
these rules; keep new file-backed features inside them.

Owner API endpoints must enforce ownership from the authenticated subject and must not expose it through
published-trip responses. GPS capture is approved only for decision 244. Do not add further GPS capture, precise
addresses, media uploads, or automatic archive migration without an explicit product/privacy decision.

Live location exception (#244, 2026-11-09): the owner explicitly approved exact live-track storage and current-only
audience sharing. Earlier blanket no-GPS-history/live-location statements are superseded only by
[decision 244](docs/decisions/244-live-location-tracks.md). Tracks stay owner-only until explicit deletion; freshness
expiry preserves them. Review each enabled audience and its delivered precision before sharing. Live coordinates and
tracks are excluded from PDF, Atom and ordinary trip exports; owner track export is a separate deliberate download.
Database and HA backups may retain deleted history until their independent retention expires.

### Commits and pull requests

Use short, imperative, sentence-case commit titles, for example `Add reusable travel maps and document previews`. Keep
each commit focused. Reference a relevant GitHub issue for substantive work and update `PLAN.md` when its order changes.
Pull requests should state the affected public/private routes, describe visual checks, and note the manual checks run.

### Deferred work and repo scope

If a gap fits inside the change already in progress — same repository, fixable now, nothing else it depends on is
missing — fix it there directly instead of deferring it. Opening an issue for something you could just do is its own
way of leaving it undone. Open an issue only for what genuinely doesn't fit: it belongs in a different repository, it
depends on work that doesn't exist yet, or a product/privacy decision deliberately put it out of scope.

When a change surfaces work that is legitimately out of scope — even when the reason is a deliberate boundary already
documented elsewhere, like `PLAN.md`'s v1 "application-only" vs v2 "VPS cutover" split — open a concrete GitHub issue
for it before considering the change done. A sentence in a README, docstring, or commit message explaining why
something was left out is not the same as something that will actually happen; it must also be tracked. Check first
whether an existing issue already covers it (for example, PLAN.md's "Coordination" notes and each issue's
"Dependencies" section usually point to the right one) before opening a duplicate.

Route each issue to the repository that owns the work, not reflexively to this one: `tjorim/travel` owns the
application — its API, PWA, and static archive. `tjorim/apps` owns shared VPS infrastructure — deployment,
container/service wiring, cron/systemd scheduling, and backup/restore. Work that only runs on the VPS (a scheduled job,
storage provisioning, Caddy or Keycloak wiring) belongs in `tjorim/apps` even when the function or code it invokes
lives here; link back to the originating `tjorim/travel` issue or PR for context instead of duplicating that context
into the new issue.

GitHub issues are living documents: do not add comments to them. Record clarifications, decisions, new sub-issue links
and corrections by editing the issue body (read it first, keep the original text, and add or adjust a clearly headed
section). This applies to closed issues too.

## API contract

The backend's response models are the source of truth for the frontend's API types, and nothing in between is written by hand:

```text
backend response models -> uv run python -m app.openapi_export (pnpm api:generate)
  -> frontend/openapi.json -> Orval (frontend/orval.config.mjs) -> frontend/src/api-schema/
  -> frontend/src/api-types.ts (the one import point for API shapes)
```

- `frontend/openapi.json` is a committed snapshot of the backend's OpenAPI document with `info.version` pinned to
  `"snapshot"`, so a release bump never stales it. `frontend/src/api-schema/` is generated from it, one file per
  schema. Never hand-edit either, and do not declare an API record type anywhere else in the frontend.
- To add or change an endpoint: give the route a `response_model` (a test enforces it; a response model derives from
  `ResponseModel` in `backend/app/schemas.py` so a field with a default is required in the generated type), run
  `pnpm api:generate` in `frontend/` (it needs `uv`), commit `openapi.json` and `src/api-schema/`, and alias the
  generated record for the screens in `frontend/src/api-types.ts`.
- `pnpm typecheck` runs `pnpm api:check` and fails when `src/api-schema/` is stale; the backend test
  `test_openapi_snapshot` fails when `openapi.json` is stale. `backend/tests/test_response_models.py` fails on a JSON
  route without a documented response schema, and on an optional response field without a per-field
  wire-omission reason in `OPTIONAL_ON_THE_WIRE` (it rejects both new unexplained fields and stale exceptions).
  Request optionality is a separate contract.
- `python-travel` is published on its own and keeps a small hand-written copy of the wire models it reads;
  `backend/tests/test_python_client_models.py` holds that copy to the OpenAPI schema instead of generating it.
- Success fixtures (MSW handlers, fetch doubles, Playwright route fulfils) must choose a generated response schema
  explicitly: `HttpResponse.json<Api.Model>(...)`, `jsonResponse<Api.Model>(...)`, the stateful fake API's explicit
  schema generic, or `satisfies Api.Model` at a browser response boundary. The generic JSON helpers use `NoInfer`
  and default to `never`, so a payload never infers its own contract. The source guard
  `frontend/tests/mocks/fixture-contracts.test.ts` fails on a fixture that is unchecked or erased
  (`as unknown`, `any`), and `fixture-contracts.typecheck.ts` holds compile-only negative checks.
- A deliberately malformed, error, external-provider, control or persistence fixture is exempt only with a comment
  at the call site that says why, starting `Fixture exception:` or `Deliberately malformed:`.

## Testing

Run the checks CI runs before pushing, from `frontend/`: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`
(+ `pnpm format:repo:check`), `pnpm test`, `pnpm build`, `pnpm bundle:test && pnpm bundle:check`, `pnpm locale:audit`,
`pnpm check-message-parity` and `pnpm ui:test && pnpm ui:check`; from `backend/`: `uv run ruff check .`,
`uv run ruff format --check .`, `uv run ty check .` and `uv run pytest`. `pnpm test:e2e` needs
`pnpm exec playwright install chromium`. The media tests need `ffmpeg` on `PATH`, and the `*_postgres.py` tests and
the migration cycle need a PostgreSQL database. Other components have their own checks (`python-travel/`,
`home-assistant/`); see their jobs in `.github/workflows/ci.yml`.

## CI

`.github/workflows/ci.yml` detects which components a change touches and calls the component workflows
(`backend-ci.yml` and `frontend-ci.yml`); unchanged components show as skipped. The
`CI gate` job fails when any needed job failed or was cancelled. CodeQL runs through GitHub's default setup (repository settings), so there are no `codeql-*.yml` files here, unlike the other apps; do not add them while the default setup is on, because GitHub rejects advanced-workflow uploads in that case. The `Frontend` caller runs `Frontend / Checks` and
`Frontend / E2E shard n/3` (three Playwright shards, with the Chromium cache keyed by the Playwright version); the
`Backend` caller runs `Backend / Checks` against PostgreSQL, including the migration upgrade/downgrade cycle with a
pinned `ffmpeg`. `ci.yml` itself also runs the Python client, Home Assistant, HACS, dependency-audit,
release-metadata and repository-formatting jobs. Action versions are pinned to commit SHAs with the version in a
comment; Renovate keeps them current.

## Release

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

## Pitfalls

- Never hand-edit `frontend/openapi.json` or `frontend/src/api-schema/`; regenerate them, and do not declare API record
  types elsewhere in the frontend.
- `frontend/src/paraglide/` is generated and git-ignored: run `pnpm paraglide:compile` (or `pnpm typecheck`) after a
  fresh checkout before running `tsc` directly. `pnpm test` compiles it through the Vitest plugin.
- `TRAVEL_ENVIRONMENT=development` without a `TRAVEL_DATABASE_URL` uses a SQLite file built from the models, not from
  the migrations; production is PostgreSQL, so verify schema changes with `alembic upgrade head` and `alembic check`
  against PostgreSQL.
- `@tanstack/react-form` stays on 1.x in this repo; the 2.0 alpha the other apps use changes the field and submit APIs.
- `openapi-typescript` and `@hey-api/openapi-ts` fail under TypeScript 7; the API types come from Orval only.
- Keep `.github/` workflows, `scripts/` and the root JSON files formatted with `pnpm format:repo` (CI runs
  `format:repo:check`).
