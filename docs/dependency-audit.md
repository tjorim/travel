# Dependency audit

CI audits both complete lockfiles on every PR, main push, manual run and Monday
at 07:00 UTC. The CI gate requires the audit to pass even for documentation-only
PRs. Run it locally with `GH_TOKEN=$(gh auth token) python
.github/scripts/dependency-audit.py` (requires uv, pnpm and the pinned Node version).

The backend exports all dependency groups from the frozen uv lock, excluding the
local project, then runs pinned pip-audit 2.10.1 with hashes and no resolution or
installation of audited packages. pip-audit's PyPI results do not provide severity;
the script looks up each finding's GHSA alias through GitHub's advisory API.
The frontend uses pnpm audit against its lockfile, including development tools.
High and critical advisories fail. Low and moderate findings remain in the full
JSON log and summary. Missing severity/aliases, unaudited packages, malformed
reports, API/network errors and audit-tool failures block the gate rather than
silently passing. All raw findings, including exceptions, remain visible.

## Reviewed ignore list

`.github/dependency-audit-ignores.json` is the single exception list for both
ecosystems. It is deliberately empty after the #35 review on 2026-10-30: patched
versions are available for all targeted dependencies. No applicability judgement
in #35 suppresses future findings automatically.

Any new exception must be reviewed in a PR and include an exact advisory `id`
(GHSA, CVE or PYSEC alias), a concrete `reason` tied to application reachability,
a `review` issue/PR URL, and an ISO `expires` date. Expired entries stop suppressing
findings. Never ignore a package or severity wholesale. Example schema:

```json
[
  {
    "id": "GHSA-example-only",
    "reason": "Describe the verified unreachable vulnerable operation",
    "review": "https://github.com/tjorim/travel/issues/35",
    "expires": "2026-11-30"
  }
]
```

The remaining low-severity `GHSA-gcqx-w48m-w2h4` finding is deepmerge through the
shadcn development CLI. It is reported, not ignored. Travel does not import this
CLI in the browser or backend; reconsider exposure when running the CLI on
untrusted configuration. Decoder restrictions remain tracked by #24.
