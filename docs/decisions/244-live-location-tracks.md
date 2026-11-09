# Live location and retained exact tracks (#244)

Approved by the owner on 2026-11-09, including the explicit instruction to start
implementation. This supersedes earlier no-live-GPS/no-history proposals in #244,
decision 36, the domain model and PLAN only for this opt-in feature.

Travel accepts exact coordinates from an explicitly selected HA person or device
tracker, without Dawarich. Every accepted point belongs to one owner/source/trip
session. Sessions start disabled. Stopping/revoking a session stops ingestion and
visitor delivery; starting again clears its current position, never its tracks.
Changing the selected entity requires a new session. A person's underlying device
may change without changing the selected person identity. No visits, routes,
stays, updates or other content are inferred.

Tracks remain owner-only until explicit deletion, with paginated inspection and
portable JSON export. They are excluded from visitor projections, Atom, PDFs and
ordinary trip export. Deleting tracks clears the current position too. Database
backups may retain deleted points until the configured backup rotation expires;
restoring an older backup can restore them. Travel cannot erase downloaded copies,
HA recorder/history or HA backups. Owners must configure HA recorder exclusions
and backup retention independently. No automatic retention cutoff is promised.

Only the current position may be shared, separately enabled for the public trip
or each selected hidden link. Collection members receive no live location.
Precision is selected per audience: exact, rounded to two decimals (roughly 1 km)
or one decimal (roughly 10 km); these grids are approximate, not anonymity
boundaries. The server constructs a strict coordinate/time/staleness allowlist;
source identifiers, accuracy, entity names and tracks never accompany it.
Underlying publication/link activation, expiry and revocation remain mandatory.

Age is computed from the validated observation timestamp against server time.
Current becomes stale at one hour and disappears from visitor delivery at 24 hours
without a fresh accepted point, evaluated using server time. Fresh accepted input
resumes only still-enabled audiences. Expiry never deletes tracks or re-enables a
revoked link. Live responses use no-store; recipients may retain copies.

Admission also limits authenticated ingestion attempts to 120/minute per owner/IP
using the existing process-local limiter (single-worker deployment contract).
Ingestion is single-point, max 4 KiB, at most one accepted point per 30 seconds
per session. Observations must be no older than five minutes, no more than 30
seconds in the future, and strictly newer than the session watermark. Identical
retries are acknowledged without another row; conflicting timestamps and older
points are refused. Deletion preserves the watermark to prevent replay. HA sends
no backlog, and drops failed positions rather than retrying old data.

Use the existing owner OAuth contract, never visitor tokens or a new credential
scheme. Selection binds owner/source/trip in server storage; it does not narrow
the OAuth token's existing owner powers. Dedicated production HA OAuth provisioning
remains [apps#333](https://github.com/tjorim/apps/issues/333). No VPS polling job is
needed. Request/audit/diagnostic logging must omit coordinates and source states.
