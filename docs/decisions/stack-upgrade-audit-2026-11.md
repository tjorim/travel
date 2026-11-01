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
| `@axe-core/playwright` | 4.13.0 | 4.14.0 | **Blocked** | New rule `label-content-name-mismatch` fails 124 e2e tests on three real labels. Held at `~4.13.0` in the bump PR; fixed and moved to `^4.14.0` in #154 (the sweep also found the sharing overview's open, copy-link and choose-scope buttons). |
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

## New features worth using

Shortlist, with concrete spots. Nothing here was implemented.

- **Temporal (Node 26 and current browsers) (verified for Node 26 via press
  coverage; browser support unverified).** `dayjs` is used in 11 files
  (`src/dayjs.ts`, `date-input.ts`, `tracker-model.ts`, `trips/**`). Temporal's
  `ZonedDateTime` and `PlainDate` map directly to the ISO date and timezone
  payloads the app already preserves. Worth a spike only once the browser
  baseline supports it without a polyfill; keep dayjs until then.
- **Vite 8 / Rolldown.** The build already warns to use
  `build.rolldownOptions.output.codeSplitting` instead of manual chunks
  (see `docs/decisions/403-owner-code-splitting.md`). Moving the chunking to
  that option is a small, measurable change against `bundle-budget.json`.
- **React 19.x.** `useMemo`/`useCallback` appear ~67 times in `src`; the React
  Compiler would make most unnecessary **(unverified for this codebase)**.
  Trial it behind the existing bundle and e2e checks.
- **Python 3.15 (unverified, from release notes as known).** PEP 810 explicit
  lazy imports could defer `fastmcp`, `PIL` and `timezonefinder` (13 import
  sites in `app/`) off the API start-up path; the new sampling profiler
  (`profiling.sampling`) complements `docs/profiling.md`.
- **PostgreSQL 18 (unverified).** Native `uuidv7()` could replace the single
  `uuid4` default in `app/models.py` for index-friendly keys, if ordering ever
  matters; no change needed otherwise.
- **FastAPI 0.162.** The lockfile jump ran clean; review its release notes for
  typed response and OpenAPI improvements before the next API change
  **(not read)**.
- **SQLAlchemy 2.1 (unverified).** Check the 2.1 migration notes
  (docs.sqlalchemy.org/en/21/changelog/migration_21.html) for removed legacy
  patterns; `alembic check` already reports no drift.
- **Playwright 1.64 / axe-core 4.14.** The new axe rule is itself a real
  accessibility gain (WCAG 2.5.3): fixing the three findings in #154 improves
  voice-control users.

## Could not verify

- Release-note details for TypeScript 7, React 19.3, Tailwind 4.3, FastAPI
  0.143-0.162, SQLAlchemy 2.1 and Python 3.15 features; the shortlist reflects
  background knowledge and should be checked before work starts.
- PostgreSQL 19 general availability (Docker Hub showed only `19rc1`).
- Browser support level for Temporal.
- Behaviour of the production VPS on Node 26; that belongs to tjorim/apps#301.
- The `dependency-audit` job on Node 26 outside the local run (it is run by
  CI on #150).

## Follow-up issues

- [#154](https://github.com/tjorim/travel/issues/154) label-in-name fixes and axe-core 4.14
- [#155](https://github.com/tjorim/travel/issues/155) raise `engines` to 26 after the VPS moves
- [#156](https://github.com/tjorim/travel/issues/156) evaluate the pnpm major
- [tjorim/apps#301](https://github.com/tjorim/apps/issues/301) VPS Node decision
