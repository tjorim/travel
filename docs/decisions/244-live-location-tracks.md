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
2 hours, or 24 hours. Omitting delays on configuration preserves saved delays. A partial delay map
updates only the supplied audience keys; explicitly send zero to remove a delay.
Removing an audience immediately stops its delivery; collection audiences remain
excluded. Review precision, delay and the actual delivered observation in the
Sharing check and owner preview before enabling an audience. A waiting state
means no observation meets the current delay/freshness gates.

At each request, server time minus delay defines the cutoff. Select only the
latest accepted point observed at or before that cutoff, using the existing
unique `(session_id, observed_at)` index, a query in reverse order and LIMIT 1;
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

## Storage and API alignment (#363, 2026-11-14)

The privacy boundaries above are unchanged: tracks stay owner-only, visitor delivery goes through the single
`current_for_audience` function, and collection members receive no live location. This only changes how the
settings are stored and described.

- **Source.** `source` is an opaque identifier the owner chooses, 1 to 128 characters of letters, digits, `.`, `_`,
  `:` and `-`, starting with a letter or digit. The core API no longer knows the Home Assistant entity-id format;
  the Home Assistant integration still sends its entity id, and every stored value stays valid.
- **Audiences are rows.** The two JSON dictionaries `audiences` and `delays` are replaced by one
  `live_session_audiences` row per session and audience, holding its precision and delay. An audience is its kind
  plus the record it names: the public view (`public`, no record) or one hidden link (`link`, the link's id). On the
  wire and in code the audience is still the key `public` or the link id; `AudienceRef` maps it to the row. Tables stay
  per kind (#360): a collection member would add its own kind and nullable foreign key, and has none today.
- **No stale settings.** A link's row references `share_links` with `ON DELETE CASCADE`. Revoking, expiring or
  rotating a link and unpublishing the public view remove the row explicitly (`forget_audience`), so a setting never
  outlives the audience it was for and a republished page or a re-created link does not resume sharing. Deleting a
  trip or a session removes its rows. Setting an audience needs a draft or active link of the same trip.
- **Delays.** A delay belongs to its audience row: removing an audience removes its delay, and an audience added later
  starts at zero unless the request names one. A partial `delays` map still changes only the audiences it names, and
  omitting it keeps every saved delay of the audiences that remain.
- **Tables.** `live_sessions` gains `created_at` and `updated_at`; `current_id` is a foreign key to `live_points`
  (cleared when the point is deleted); the `live_points` constraints are named; areas and locations get the same
  coordinate range checks. Migration 032 moves the saved dictionaries into rows, dropping those of links that were
  deleted, revoked or expired, and the downgrade writes the dictionaries again.
- **API.** The request and response models live in `schemas.py` (requests on `InputModel`), every route declares its
  response model and the operations are typed in the OpenAPI schema. Errors use specific codes (`live_session_limit`,
  `live_disabled`, `live_timestamp`, `live_order`, `live_rate_limit`, `live_audience_unavailable`,
  `live_delay_audience`, `live_position_too_large`, `live_invalid_position`, and `not_found`).
