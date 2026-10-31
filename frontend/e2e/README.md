# End-to-end checks

Run `pnpm e2e` from `frontend/` against the mocked API.

## CI sharding

The CI workflow runs all 404 smoke/accessibility tests in three parallel shards
(`--shard=N/3`, 135/135/134 tests), with fail-fast disabled. No locale, theme,
viewport, screenshot or axe coverage is removed. Each shard uses two workers.
Local drawer repeats passed 12/12 with one worker (2.4 min) and two workers
(1.5 min). A clean two-worker shard passed 135/135 in 3.2 min without retries.
CI timings must measure the runner rather than extrapolate from local timings.

The aggregate retains the `Frontend end-to-end` check name and feeds `CI gate`.
It rejects failed, cancelled or unexpectedly skipped shards. When component
detection skips frontend checks, the aggregate is also skipped.
Browser binaries are cached by OS, architecture and installed Playwright version;
system dependencies are installed even on cache hits.

Failed shards upload `playwright-failure-N` containing retained failure traces
and a blob report. Open traces with `pnpm exec playwright show-trace <trace.zip>`;
use `pnpm exec playwright merge-reports --reporter=html <blob-directory>` for
an HTML report. Artifacts expire after seven days.

Measurements: the reported historical unsharded job range is 8–13 minutes.
PR-specific baseline and sharded-run measurements are recorded in the PR once
the runs finish; no speedup is claimed from pending CI.
