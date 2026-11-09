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
The original zero-delay policy became stale at one hour and disappeared at 24 hours
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

## Per-audience delayed delivery (#332, 2026-11-09)

The owner authorized application implementation before infrastructure, superseding
#332's initial “do not implement yet” wording. Each public/hidden-link audience
keeps its own precision and delay: zero (legacy/default), 15 or 30 minutes, 1 or
2 hours, or 24 hours. Omitting delays on configuration preserves saved delays.
Removing an audience immediately stops its delivery; collection audiences remain
excluded. Review precision, delay and the actual delivered observation in the
Sharing check and owner preview before enabling an audience. A waiting state
means no observation meets the current delay/freshness gates.

At each request, server time minus delay defines the cutoff. Select only the
latest accepted point observed at or before that cutoff, using the existing
unique `(session_id, observed_at)` index, a reverse ordered query and LIMIT 1;
never load a track or deliver newer points/history. Round only that selected
point to the audience precision. Even accepted future clock skew is withheld
until eligible. Visitor labels show the actual observation timestamp and delay.
A point is stale strictly more than one hour behind the delayed cutoff, and
omitted strictly more than 24 hours behind it (equal boundaries remain eligible).
Independently, delivery stops when the latest accepted observation is at least
24 hours old, irrespective of delay. Thus a 24-hour delay works while a source
is active, but a stopped source still disappears at 24 hours. This preserves the
original source-inactivity privacy promise. The response includes a delivery
expiry so open views also drop expired points; visitor pages refresh no-store
every 30 seconds, including when no eligible point is available yet. Refresh
failures clear the displayed projection rather than retaining old delivery.

Disable/revoke/expiry/deletion gates remain immediate on the next request,
independent of delay. Restart requires fresh input; deleting tracks leaves no
eligible point and preserves the replay watermark. Retained tracks remain
owner-only, excluded from Atom, PDFs and ordinary trip exports. There are no new
GPS sources, coordinate logs, background jobs or infrastructure requirements;
production OAuth provisioning remains apps#333.
