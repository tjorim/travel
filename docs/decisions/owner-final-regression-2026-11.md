# Owner Final Regression — November 2026

Date: 2026-11-01. Refs #8; epic #94. This is a bounded regression
record, **not complete release acceptance**. Issues #8/#9/#5/#94 were not edited.
The baseline was origin/main `ae21268` in a dedicated checkout.

Read first: AGENTS.md, issues #8 and #9, the visitor built-release verification,
the domain/storage/MCP review and README local/PostgreSQL instructions.
Visitor #114's full matrix was not repeated; only the requested first-screen
zoom supplement was run.

## Environment And Evidence

All data was invented. Temporary scripts, tokens, SQLite database, objects,
response evidence and logs live outside Git in `/tmp/owner-final-2026-11`.
These paths describe session evidence, not durable CI artifacts. No production
identity provider, private content or real communications were used.

Node 26.13.0 and pnpm 10.33.0; frozen install and production build. A dedicated
static server on localhost:4539 serves `frontend/dist` and proxies all API
methods to FastAPI on :8538. It supplies SPA fallbacks for owner deep links.
The API uses a fresh SQLite database and object directory. Locally generated
RS256 owner-A/owner-B JWTs are checked by the real API auth path against a local
JWKS server on :8539; no authenticated-subject dependency override is used in
these HTTP probes. Browser sessions are seeded with those test JWTs rather
than contacting Keycloak. This does not verify real-provider sign-in.

The shared preview tool returned `available: false`; browser automation uses
Playwright Chromium. Existing repository e2e suites remain a separate mocked
Vite layer and must not be described as live-API built-release journeys.

A disposable PostgreSQL 17 container on localhost:55438 uses synthetic data.
Only processes/containers created for this pass are stopped.

## Results Matrix

Each evidence row below was executed on **2026-11-01**. A narrower automated
assertion is not a claim that every related human interaction was inspected.

| Journey / boundary | Evidence and scope | Result |
| --- | --- | --- |
| Real API A/B isolation | `probe.py`, `api-results.json`: B GET of A trip, links, export and collection; trip PATCH/DELETE and collection revoke/add-member all return 404 | Pass for listed endpoints; reciprocal exhaustive method matrix not run |
| Anonymous public, unlisted, collection index/member | Live HTTP; deliberate title/story scope; private summary, private update note and collection-label canaries absent | Pass |
| Sharing collection lifecycle | Live HTTP create/add/activate/rotate/remove/revoke; old capability fails after rotation, removed member fails, revoked capability fails | Pass |
| Collection expiry | Synthetic database timestamp set in past; live anonymous GET returns 404 (`expiry-result.txt`) | Pass; not a wall-clock waiting test |
| JSON export | Live owner download excludes tested link/collection capability strings; B receives 404; backend export suite checks full schema exclusions | Pass for stated assertions |
| Owner header 320/360/390/430, nl/en, light/dark | Built Chromium matrix, DOM horizontal overflow assertions and 30-Tab focus trace per load (`browser-results.json`) | See run totals below |
| Header zoom supplement | Built matrix includes 1093×614 @1.25 and 911×512 @1.5 in both locales/themes | See run totals below |
| Visitor first screen zoom supplement | `visitor-zoom.json`: 12 built loads, 320px plus both laptop equivalents, both locales/themes; title present, no document overflow, 30-Tab traces | Pass |
| Sharing overview keyboard | Built `/admin/sharing` matrix, loaded synthetic content, overflow and 30-Tab trace (`sharing-keyboard.json`) | See run totals below; traversal trace alone does not certify every action |
| Failed save, pending edits, dirty dismiss, history/back, focus return | Existing `record-guard`, `return-navigation`, `session-renewal` e2e and unit suites | Automated regression layer; full live built failure-injection journey remains unrun |
| Capture owner/two-tab fencing | Existing `capture-draft` e2e (nl/en) and frontend unit tests | Mocked regression layer; live built A/B two-tab journey remains unrun |
| Offline copies/private boundaries | Frontend offline unit suites and production-shell offline suite | See totals below; live API private pin/decrypt/logout journey remains unrun |
| Trip deletion object queue/purge | Backend `test_trip_cleanup.py`, storage reconciliation and PostgreSQL deletion/worker tests | Automated service/API boundary; not repeated from built owner UI |
| PostgreSQL migrations | Upgrade through 018, `alembic check` no drift, downgrade base, second upgrade | Pass |
| PostgreSQL-enabled backend suite | `TRAVEL_TEST_DATABASE_URL` points to disposable PostgreSQL; ordinary tests retain their own isolated fixtures | See totals below; not every backend test runs on PostgreSQL |

## Limitations And Remaining Work

This pass must not close #8. Remaining live built-release work includes the
failed-save/dirty-editor/history/focus permutations, Capture with two subjects
and two tabs, private offline pin/decrypt/sign-out boundaries, trip deletion
through the UI and full sharing-overview keyboard activation. Extend the A/B
HTTP matrix reciprocally, including mutation methods on links and exports.
No new application defect was established by the completed probes; no defect
issue was opened merely to track unfinished test execution.

Real phone browser, physical touch, TalkBack, native browser chrome zoom and
text-only zoom, real Keycloak, deployed performance and deployed response
headers were not verified. Deployment/header ownership remains
[tjorim/apps#219](https://github.com/tjorim/apps/issues/219).

The zoom supplement uses Playwright `deviceScaleFactor` **with reduced CSS
viewports**, not CDP `Emulation.setPageScaleFactor`: 1093×614 at 1.25 and
911×512 at 1.5 approximate a 1366×768 laptop, plus a 320px width. This verifies
layout reflow equivalence; it does not operate Chromium's zoom menu.

## Check Totals

Run totals are recorded below after completion. No runtime source or UI
component changes were made; no screenshots, tokens, databases or raw response
artifacts are committed.

- Frozen install and `format:check` passed with the pinned toolchain.
- `lint`, `check`, `locale:audit`, `ui:check`, `build`, `bundle:check` passed.
- Frontend unit tests: **93 files, 649 tests passed**.
- Built owner header matrix: **24 loads passed**, 720 recorded Tab positions.
- Visitor first-screen supplement: **12 loads passed**, 360 Tab positions.
- Production-shell offline suite: **8 passed** (its documented fixture API layer).
- Live HTTP probe: **34 checks passed**, plus expired collection HTTP 404.

Fixture-script development initially assumed the wrong collection response
shape/status and sampled a loading screen too early. Corrected harness runs
are the reported evidence; these did not establish application defects.
Repeated probe attempts left additional synthetic trips in the disposable
fixture database; no real data was involved.
- Built sharing-overview matrix: **24 loads passed**, 720 Tab positions.
- PostgreSQL-enabled backend suite: **688 passed, 5 skipped**, 11 warnings;
  `ruff check .` and `ty check .` passed. Skips remain unverified coverage,
  including external media-worker integration; this pass supplies no worker host.

The broad mocked-Vite browser selection was interrupted to keep this handoff
bounded: **44 passed, 4 failed, 2 interrupted, 112 did not run**. Failures
include record history/deferred-save control timeouts and public return
navigation request waits. They are **not passes** and have not been established
as product defects. Raw traces/error contexts were copied to the temporary
evidence directory. A serial focused retry uses a 60-second timeout; even a
passing retry cannot erase this initial result. The complete affected browser
selection still needs a clean run. No application fix is claimed.

Focused serial retry: **14 passed** (`record-guard`, `session-renewal`,
`sharing-overview`, 60-second timeout, `retry.log`). All four record-guard cases
passed on retry. Return-navigation failures were not retried; no cause is
asserted. Local fixture API/static processes and PostgreSQL container were
stopped after evidence collection. The working tree contains no runtime edits.
