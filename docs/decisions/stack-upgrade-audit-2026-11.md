# Stack upgrade audit, November 2026

Audit date: 2026-11-01. Epic #94. Versions were read from the npm registry,
PyPI, Docker Hub, the Node.js dist index and GitHub releases on that date.
Feature notes marked **(unverified)** come from background knowledge or search
snippets, not from reading the release notes in this session.

## Outcome

| PR | Scope | State at writing |
|---|---|---|
| [#150](https://github.com/tjorim/travel/pull/150) | Node 26.13.0 LTS toolchain, `@types/node` 26.6.6 (supersedes Dependabot #49) | open |
| [#158](https://github.com/tjorim/travel/pull/158) | maplibre-gl, shadcn CLI, Playwright, Vitest, TanStack Query, lucide-react, Paraglide, fake-indexeddb, happy-dom, cn | open |
| [#153](https://github.com/tjorim/travel/pull/153) | Backend lock refresh incl. FastAPI 0.162, Starlette 1.10, SQLAlchemy 2.1.6 | open |

## Version table

"Risk" is the risk of taking the latest version today.

### Runtime and toolchain

| Component | Current | Latest | Risk | Note |
|---|---|---|---|---|
| Node | 24.14.0 (`.node-version`), `engines >=24` | 26.13.0 **LTS "Lithium" since 2026-10-28**; 24.22.2 is LTS "Krypton" | Low | Full suite and 531 e2e tests pass on 26. VPS still provisions 24 (see below). |
| `@types/node` | 24.19.2 | 26.6.6 | Low | In #150. |
| pnpm | 10.33.0 | 10.34.9 (10.x), 12.16.1 (major) | Medium for the major | 10.x patch is safe but cosmetic; major tracked in #156. |
| Python | 3.15 (CI, Docker) | 3.15.2 | None | Current. |
| uv | 0.13.6 (Dockerfile), setup-uv unpinned | 0.13.6 | None | Current. |
| PostgreSQL | 18 (CI), 18.6-trixie (compose) | 18.6; 19 only at `19rc1` on Docker Hub | None | PG 19 GA not verified; do not move before it is GA and `postgres:19` exists. |
| Caddy image | `caddy:2-alpine` | 2.11.7 | None | Floating tag. |
| busybox / static-ffmpeg | 1.38.0 / 9.0.2-1 | 1.38.0 / 9.0.2-1 | None | Current. |

### Frontend

| Package | Current | Latest | Risk | Note |
|---|---|---|---|---|
| React / react-dom | 19.3.1 | 19.3.1 | None | Current (`latest` range). |
| TypeScript | 7.0.2 | 7.0.2 | None | Current. |
| Vite | 8.3.5 | 8.3.5 | None | Current (Rolldown based). |
| `@vitejs/plugin-react` | 6.1.2 | 6.1.2 | None | Current. |
| Tailwind / `@tailwindcss/vite` | 4.3.3 | 4.3.3 | None | Current. |
| `@base-ui/react` | 1.9.0 | 1.9.0 | None | Current. |
| shadcn CLI | 4.22.1 | 4.23.0 | Low | `pnpm ui:upstream` reported 0 changed definitions. In the frontend bump PR. |
| maplibre-gl | 6.15.0 | 6.16.0 | Low | In the frontend bump PR; bundle budgets unchanged. |
| Playwright | 1.64.0 | 1.64.1 | Low | In the frontend bump PR. |
| Vitest | 5.0.4 | 5.0.5 | Low | In the frontend bump PR. |
| oxlint / oxfmt | 1.90.0 / 0.75.0 | 1.90.0 / 0.75.0 | None | Current. |
| `@inlang/paraglide-js` | 2.29.2 | 2.29.3 | Low | In the frontend bump PR. |
| `@axe-core/playwright` | 4.13.0 | 4.14.0 | **Blocked** | New rule `label-content-name-mismatch` fails 124 e2e tests on three real labels. Held at `~4.13.0`; fix tracked in #154. |
| TanStack Query / Router / Form | 5.104.5 / 1.170.46 / 1.33.5 | 5.105.1 / same / same | Low | Query in the bump PR. |
| lucide-react | 1.62.0 | 1.66.0 | Low | In the bump PR; type check and tests pass. |
| msw, happy-dom, dayjs, react-day-picker, testing-library | | current or patch | Low | happy-dom patch in the bump PR. |

### Backend

| Package | Current | Latest | Risk | Note |
|---|---|---|---|---|
| FastAPI | 0.143.0 | 0.162.0 | Medium (19 minors on a 0.x) | Suite passes unchanged on PostgreSQL 18. |
| Starlette | 1.8.0 | 1.10.0 | Low | Transitive of FastAPI. |
| SQLAlchemy | 2.1.4 | 2.1.6 | Low | Patches only; `alembic check` clean. |
| Alembic | 1.20.0 | 1.20.1 | Low | |
| Pydantic / settings | 2.14.1 / 2.16.0 | 2.14.2 / 2.16.2 | Low | |
| FastMCP | 4.1.3 | 4.1.4 | Low | |
| psycopg, cryptography, pillow, httpx, uvicorn, nh3, markdown-it-py | | current | None | |
| timezonefinder | 9.0.0 | 9.2.0 | Low | Drops the `h3` dependency. |
| Ruff / ty / pytest | 0.17.0 / 0.0.87 / 9.1.1 | 0.17.3 / 0.0.95 / 9.2.0 | Low | ty is 0.0.x: expect new diagnostics; none appeared. |

### GitHub Actions

All pinned by SHA and current: checkout 7.0.1, paths-filter 4.0.3,
setup-python 7.1.0, setup-node 7.1.0, pnpm/action-setup 6.1.0, cache 6.1.0,
upload-artifact 7.0.2. `astral-sh/setup-uv` is pinned at 10.3.2; 10.3.3 exists
and Dependabot's weekly run will propose it, so it was left alone here.

## Recommended order

1. Node 26 toolchain (#150), independent of runtime.
2. Frontend in-range bumps (shadcn CLI after `ui:upstream`, which was clean).
3. Backend lock refresh (#153).
4. Fix the label-in-name findings, then axe-core 4.14 (#154).
5. After tjorim/apps#301 moves the VPS to Node 26, raise `engines` (#155).
6. Evaluate the pnpm major (#156).
7. PostgreSQL 19 only after GA and an image tag exist; no issue yet because there is nothing to act on.

There are no outstanding React, Tailwind, Vite, TypeScript or SQLAlchemy
majors: all are on the latest major.

## VPS and Node

`tjorim/apps` `ansible/playbooks/provision.yml` adds the NodeSource `node_24.x`
repository, installs `nodejs>=24`, and builds every app on that host. Travel
therefore keeps `engines >=24` while CI and local development use 26.13.0. That
is safe: the frontend build output is produced by Vite/Rolldown, not by Node
language features, and the Playwright suite exercises the built behaviour on
26. The mismatch is documented in the README. The VPS decision is
[tjorim/apps#301](https://github.com/tjorim/apps/issues/301); `Caddyfile.example`
is unaffected.

## Release notes of the frontend bump PR (#158)

Read on 2026-11-01 from the upstream release pages. Nothing here touches code
we use.

| Package | Versions | Verified result for our code |
|---|---|---|
| maplibre-gl | 6.15.0 to 6.16.0 ([releases](https://github.com/maplibre/maplibre-gl-js/releases)) | Additive `setMaxBounds` per axis and `transformStyle`; fixes for terrain, GeoJSON `updateData`/`getBounds`, iOS worker shutdown. No breaking changes. `aroundCenter` was deprecated in 6.15; `src` uses none of `aroundCenter`, `dragRotate`, `setMaxBounds`. No action. |
| Playwright | 1.64.0 to 1.64.1 ([releases](https://github.com/microsoft/playwright/releases)) | Two bug fixes (Electron first window; Chromium 155+ preflighted redirects with routes). We use neither Electron nor cross-origin redirects. No action. |
| Vitest | 5.0.4 to 5.0.5 ([releases](https://github.com/vitest-dev/vitest/releases)) | Bug fixes only (hook cleanup after failed hooks, mock release, cancel). No action. |
| shadcn CLI | 4.22.1 to 4.23.0 ([changelog](https://github.com/shadcn-ui/ui/blob/main/packages/shadcn/CHANGELOG.md)) | 4.23.0 only moves the CLI's MCP server to MCP SDK v2; 4.22.x notes cover Zod 4 schemas, `add --all` listing and undici. We use the CLI to copy components only; `pnpm ui:upstream` reported 0 changed definitions. No action. |
| TanStack Query | 5.104.5 to 5.105.1 ([releases](https://github.com/TanStack/query/releases)) | Only 5.105.1 was readable: it removes `fetchStatus` from the `isFetching` filters and fixes an `infiniteQueryOptions` overload. `src` calls neither `isFetching(` nor `useIsFetching`. 5.105.0 and 5.104.6 to 5.104.x were not listed on the page (not verified). |
| lucide-react | 1.62.0 to 1.66.0 ([releases](https://github.com/lucide-icons/lucide/releases)) | New icons; one rename in 1.63.0 (`archive-restore` to `archive-arrow-up`), which `src` does not use. No action. |
| Paraglide | 2.29.2 to 2.29.3 ([changelog](https://raw.githubusercontent.com/opral/paraglide-js/main/CHANGELOG.md)) | Bundler plugins stop rewriting unchanged output (fewer dev-server watch loops). 2.29.2 emits declarations with TypeScript 7 when installed under the `@typescript/native` alias; we use TypeScript 7 directly, so nothing changes. No action. |
| happy-dom | 21.0.3 to 21.0.4 ([releases](https://github.com/capricorn86/happy-dom/releases)) | Security fixes (ESM compiler code injection, `data:` iframe isolation, authorization header on redirects). Test-only dependency; take the bump. |
| fake-indexeddb | 6.2.6 to 6.2.7 ([changelog](https://github.com/dumbmatter/fakeIndexedDB/blob/master/CHANGELOG.md)) | Faster `put`/`delete` on stores with indexes. Test-only. |
| cn | 0.5.0 to 0.5.1 | Release notes not found (not verified). The type check, tests and bundle budgets passed in #158. |

## New features worth using (verified 2026-11-01)

Each entry says what was read, what applies to our code, and the verdict.
Effort: S under a day, M a few days, L more.

| Item | Verdict | Owner decision |
|---|---|---|
| Vite/Rolldown `codeSplitting` | Partly. The audit's earlier claim was wrong; see below. | No |
| React Compiler | **No** for now (measured worse). | No |
| Temporal instead of dayjs | **No** (browser baseline). | No |
| Python 3.15 lazy imports | **No useful gain** (measured). | No |
| PostgreSQL 18 `uuidv7()` | **No** (our ids are not UUID columns). | No |
| FastAPI 0.143 to 0.162 | Nothing to adopt; breaking changes do not touch us. | No |
| SQLAlchemy 2.1 | Nothing to adopt; the removals do not touch us. | No |
| TypeScript 7 / Tailwind 4.3 / Base UI 1.9 | No simplification of existing code found. | No |
| axe-core 4.14 label-in-name rule | Yes, already tracked in #154. | No |

### Vite 8 / Rolldown `codeSplitting` (partly)

- Sources: [Vite build options](https://vite.dev/config/build-options),
  [Rolldown manual code splitting](https://rolldown.rs/in-depth/manual-code-splitting),
  and a local `pnpm build` on Vite 8.3.5.
- The earlier claim "the build already warns to use `codeSplitting` instead of
  manual chunks" is **wrong**. `frontend/vite.config.ts` has no `manualChunks`
  and no `codeSplitting`; chunking comes from the dynamic `import()` boundaries
  in `docs/decisions/403-owner-code-splitting.md`. The only warning is Vite's
  generic "some chunks are larger than 500 kB" for the lazily loaded
  `maplibre-gl` chunk (1,094 kB raw, 296 kB gzip), which is a vendor library
  loaded on demand and not an initial-load problem. Its text suggests
  `codeSplitting` as one option; nothing there is actionable for us.
- `codeSplitting.groups` would only help cache reuse (vendor chunk stays hashed
  while app code changes) and parallel download of large libraries. Rolldown's
  documentation also says manual groups force a `runtime.js` chunk. The app
  already has a measured bundle budget (`bundle-budget.json`: admin initial 630
  kB raw / 209 kB gzip) and long-lived vendor chunks gain little in a small
  private app, so no change is worthwhile.
- One verified, real item: Vite 8 marks `build.rollupOptions` **deprecated** as
  an alias of `build.rolldownOptions`. `vite.config.ts:121` uses
  `rollupOptions.input`. Renaming it builds identically (tested: build passes,
  `pnpm bundle:check` met). Size S, no owner decision. Tracked in [#159](https://github.com/tjorim/travel/issues/159).

### React Compiler (no)

- Sources: [React Compiler introduction](https://react.dev/learn/react-compiler/introduction),
  [installation](https://react.dev/learn/react-compiler/installation). The
  compiler is stable; with `@vitejs/plugin-react` 6 it needs
  `@rolldown/plugin-babel` plus `babel-plugin-react-compiler` and
  `reactCompilerPreset()`. React advises leaving existing `useMemo`/`useCallback`
  in place because removing them can change compiler output.
- Local trial (scratch, reverted): `@rolldown/plugin-babel` 0.3.0 and
  `babel-plugin-react-compiler` 1.0.0, `babel({ presets: [reactCompilerPreset()] })`
  in `vite.config.ts`. `vite build` went from about 4.4 s to 10.3 s (2.4 times).
  Initial JS grew: admin 630.4 to 648.4 kB raw (209.3 to 216.3 kB gzip), each
  visitor entry 591.4 to 610.0 kB raw (197.0 to 204.5 kB gzip), total gzip 898.9
  to 973.4 kB (+8.3%). `pnpm bundle:check` **fails** for landing, public, share
  and total.
- The 69 `useMemo`/`useCallback` sites in `src` stay, so there is no code to
  remove, and the visitor entries (which have the tightest budget) get larger
  because the compiler injects cache bookkeeping. Verdict: not worth it; revisit
  only if profiling shows an owner-app render problem. Not run: render
  profiling or the e2e suite under the compiler.

### Temporal instead of dayjs (no)

- Sources: [caniuse](https://caniuse.com/temporal),
  [MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal).
- Chrome and Edge 144+ and Firefox 139+ support it; Safari desktop only in
  Technology Preview and Safari on iOS not at all (up to 27.2); global usage is
  about 70%. MDN lists it as not Baseline. The app is a PWA used on phones, so
  iOS support is required. Keep `dayjs` (`src/dayjs.ts`, `date-input.ts`,
  `tracker-model.ts`, `trips/**`; 11 files); a polyfill would cost more bundle
  than dayjs. Revisit when Temporal reaches Baseline. No issue: nothing to act
  on.
- The earlier "verified for Node 26" claim remains unrelated: the browser is
  the constraint.

### Python 3.15 lazy imports (no useful gain)

- Source: [What's new in Python 3.15](https://docs.python.org/3.15/whatsnew/3.15.html)
  (PEP 810: `lazy import x` / `lazy from m import n`, module scope only, not
  inside `try`, functions or classes; `__lazy_modules__`; `-X lazy_imports`).
- Measured locally on Python 3.15.0 with `-X importtime`: `import app.main`
  takes about 1.4 s cumulative. The `fastmcp` cost is not removable: `app/mcp_server.py`
  builds the `FastMCP` object, decorators and `BM25SearchTransform` at import
  and `app/main.py` mounts it, so first access happens at start-up anyway.
  `PIL` cost is 0.35 ms (cumulative) and `timezonefinder` 0.9 ms to import.
  The one measurable item is `_timezone_finder = TimezoneFinder(in_memory=True)`
  in `app/routers/areas.py:50`, about 28 ms at start-up, which lazy imports do
  not change (it is a construction, not an import). Process start-up is not on a
  user-visible path, so no change.
- The sampling profiler `profiling.sampling` (Tachyon: `attach`, `--async-aware`,
  `--flamegraph`) is real and could complement `docs/profiling.md`; it needs no
  code change, so it is a documentation note only, not an issue.

### PostgreSQL 18 `uuidv7()` (no)

- Source: [PostgreSQL 18 UUID functions](https://www.postgresql.org/docs/18/functions-uuid.html)
  and the [SQLAlchemy 2.1 notes](https://docs.sqlalchemy.org/en/21/changelog/migration_21.html)
  (server-side `uuidv7()` in batched INSERTs).
- `uuidv7()` exists and is time ordered. But `app/models.py:29` builds ids as
  `uuid.uuid4().hex` into `String(32)` primary keys (opaque capabilities and
  identifiers, not `uuid` columns), and these ids are exposed in URLs and are
  deliberately unguessable. A time-ordered id would leak creation time and
  would need a migration of every key. Rejected on privacy and cost.

### FastAPI 0.143.0 to 0.162.0 (nothing to adopt)

- Source: [release notes](https://fastapi.tiangolo.com/release-notes/) (read
  in full from the repository's `release-notes.md`).
- Breaking changes in the range: form handling (empty values, files and
  booleans treated as missing, 0.147 to 0.153, 0.162), `Path/Query/...` lose
  `**extra` (0.155), `root_path` parameter deprecated (0.146), `openapi_prefix`
  removed (0.145), JSON `null` versus omitted (0.151), parameter-model `extra`
  applies to siblings (0.160), defaults no longer validated (0.148). Our code:
  `FastAPI(...)` in `app/main.py:62` passes none of the removed arguments;
  `Form()` is used only for strings in `app/routers/documents.py` and
  `library.py`; `Query` uses only `ge`/`le`; there are no parameter models,
  boolean forms or `root_path` use. The suite passing on 0.162 (audit table)
  matches this reading.
- New features (parameter model combination and optionality, WebSocket security
  dependencies, Pydantic validation options on parameters): we have no
  parameter models or WebSockets. No useful new feature.

### SQLAlchemy 2.1 (nothing to adopt)

- Source: [2.1 migration notes](https://docs.sqlalchemy.org/en/21/changelog/migration_21.html).
  The page was read only up to its cut-off (about 100,000 of 146,000
  characters); the remainder was **not verified**.
- Relevant removals and behaviour changes: Python 3.10 dropped (we require
  3.15), psycopg 3 is the default driver (we pin `psycopg[binary]` 3.3.6 and
  `postgresql+psycopg`), autoflush now also runs for Core and `text()`
  statements, `Select.filter_by()` searches all FROM entities. `app/database.py:14`
  sets `autoflush=False`; `autoflush`, `filter_by`, `exclude_properties` and
  `inherit_schema` are otherwise not used in `app/`. `alembic check` is already
  clean (audit table). New features (typed `Table` columns, `CreateView`,
  `Delete.using()`) are available, but there is no existing code they would
  simplify.

### TypeScript 7, Tailwind 4.3, Base UI 1.9 (no simplification found)

- TypeScript 7.0 ([announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)):
  faster builds (8 to 12 times), `strict` default, `types` default `[]`. We are
  already on 7.0.2 and the speed is already in `tsc -b`; the article does not
  name a feature that simplifies our code, and its patch-level changes were not
  read.
- Tailwind 4.3 ([releases](https://github.com/tailwindlabs/tailwindcss/releases)):
  new utilities (`scrollbar-*`, `zoom-*`, stacked `@variant`) and 4.2 logical
  properties. `pnpm lint` already enforces canonical utilities; no use case
  found. Tailwind says `start-*`/`end-*` were deprecated in 4.2 for
  `inset-s-*`/`inset-e-*`: not checked in `src` (not verified).
- Base UI 1.5 to 1.9 ([releases](https://base-ui.com/react/overview/releases)):
  performance work for popups and Combobox, `createItems` for Combobox, Toast
  function updates, Drawer virtual keyboard. None is documented for the
  Autocomplete, Field, Dialog or Tabs parts we wrap, so no change to
  `docs/ui-components.md` is needed. Components must still be adopted through
  `pnpm ui:upstream`/`ui:check` and the UI maintenance process.

### Playwright 1.64 / axe-core 4.14

The new axe rule is a real accessibility gain (WCAG 2.5.3): fixing the three
findings in #154 improves voice-control users. Playwright 1.64's `--shuffle`
and `Locator.within()` exist, but nothing blocks us without them.

## Could not verify

- Release-note details for TanStack Query 5.104.6 to 5.105.0 and the `cn` 0.5.1
  release (no release page was found).
- The part of the SQLAlchemy 2.1 migration page beyond its cut-off, TypeScript
  7.0.x patch notes, and `start-*`/`end-*` use in `src`.
- Release notes were summarised from fetched pages; the FastAPI, React Compiler
  and Vite findings were cross-checked with local measurements or code, the
  others were not.
- React Compiler behaviour on render performance and e2e (only build output and
  budgets were measured).
- PostgreSQL 19 general availability (Docker Hub showed only `19rc1`).
- Behaviour of the production VPS on Node 26; that belongs to tjorim/apps#301.
- The `dependency-audit` job on Node 26 outside the local run (it is run by
  CI on #150).

## Follow-up issues

- [#154](https://github.com/tjorim/travel/issues/154) label-in-name fixes and axe-core 4.14
- [#155](https://github.com/tjorim/travel/issues/155) raise `engines` to 26 after the VPS moves
- [#156](https://github.com/tjorim/travel/issues/156) evaluate the pnpm major
- [#159](https://github.com/tjorim/travel/issues/159) use `rolldownOptions` instead of the deprecated `rollupOptions`
- [tjorim/apps#301](https://github.com/tjorim/apps/issues/301) VPS Node decision
