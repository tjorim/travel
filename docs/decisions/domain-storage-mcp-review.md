# Domain, Storage And MCP Editing Review

Review date: 2026-11-01. Implements [#113](https://github.com/tjorim/travel/issues/113),
part of [#94](https://github.com/tjorim/travel/issues/94). This is an analysis of
current source, not approval for schema changes, expanded publication, or export.
Only synthetic examples are used. No application behavior or tests change.

Read alongside [the domain vocabulary](../domain-model.md),
[decision 37](37-canonical-content-and-publication-model.md),
[decision 36](36-privacy-sharing-offline-policy.md),
[object storage](../object-storage.md), and
[browser persistence](../browser-persistence-contract.md).
The inventory below describes implementation; decision 37 also contains future
logical-schema conventions that must not be assumed to exist on every row.
In particular, tables do not universally carry schema versions, soft-delete
fields or creator/updater subjects, and owner-wide records are exceptions to its
original trip-only ownership rule.

## Records, Relationships And Representation Boundaries

The exhaustive mapped-column inventory at the end supplies field names and
source lines. ORM relationship attributes and computed response properties are
not extra stored columns. JSON fields require their request/response schemas
and service validation too; a column inventory alone is not an export contract.

| Family | Canonical relationships and meaning | Visitor boundary |
| --- | --- | --- |
| Trip | One authenticated `owner_subject`; title, summary and calendar dates; parent of trip content | Audience selects title, summary and date precision; owner ID and timestamps are excluded |
| Area / location | Every location belongs to one trip area; area has a generalized rounded point and zone; location retains address, provider snapshot and exact coordinates | Independent visibility; sharing an area does not share locations. Location needs a public label; address requires `share_address`. Area zone is private |
| Visit | Ordered stop, always an area, optional matching location; kind, status, days, local times, notes and authored summary | Title/summary, selected dates and area; time only by explicit choice with day precision; cancelled visits cannot share |
| Stay | Required location supplies area; nights, optional property, booking/contact information and local times | Area and nights at chosen precision; a separately shared location can be embedded; booking data remains private |
| Route | Two areas, optional matching endpoint locations; mode/status, schedule/zones, carrier/service, booking/class/notes and authored geometry | Fixed schedule/carrier/line allowlist; no booking/class/notes/documents. Endpoint locations require their own sharing |
| Travel update | Optional area or location, private notes, authored visitor title/body/date precision; association rows attach originals | Shared part only. A separately shared location may be embedded. Original attachments never become public by association |
| Media asset / import | Original object, capture time/local-time flag, raw metadata and provenance; import session and per-provider item records | Originals and provider provenance remain private |
| Media derivative | Generated file/poster, processing backend/state, stripping/review state; approved caption/alt/focal fields; optional update attachment and nominated cover | Only ready, stripped, approved copies. Attached copies follow the update; loose copies use own visibility. Cover nomination grants no access |
| Trip document / route-document link | Private original plus kind/title/metadata; link associates a document with a route | Never projected |
| Tasks / alerts | Trip preparation tasks, absolute completion state, due/reminder fields and JSON links; alerts record read state | Owner-only; not a scope kind |
| Packing lists / bags / items | Trip list, ordered bags/items, quantity, packed state, weight and links; owner-wide reusable template JSON | Owner-only; templates are independent of a trip |
| Owner document / emergency info | Direct owner subject, optional document trip link; emergency contacts/numbers/notes independent of trips | Never projected; linked library document survives trip deletion |
| Public surface / share link | Stored access state and scope JSON; public slug, capability verifier and expiry for named links | Live delivery gate, not a second canonical trip; raw capability is not ordinary metadata |
| Audit / MCP audit | Publication/access-change history versus separate authenticated tool-invocation history | Owner-only; MCP rows retain trip ID after deletion |
| Stored object / owner stored object / worker job | File inventory with immutable keys/checksums/state; private worker outbox with source key and retry state | Object keys and worker internals are never visitor fields |

Visitor output is a derived live representation, not an independently editable
row or a durable immutable content snapshot. `projection.py:298–348` builds only
the allowlist; `:386–406` resolves files among delivered copies. The publication
handlers (`routers/publication.py:709–875`) check live public/link access before
serving content, files or navigation. Revocation cannot retract bytes someone
already downloaded. The merged visitor `places` array is not a canonical
“place” table. Agenda, map viewports, area means, rendered Markdown, compact MCP
lists and owner thumbnails are derived views, not additional authored records.
Decision 37's historical tracks, excerpts and separate stay cards are not current
mapped record kinds; do not resurrect them in an export by reading old backlog
entries as schema authority.

## Where Data Lives

- **Database:** canonical structured records, ownership/access policy, object
  inventory and lifecycle state. Current mapped fields are in the appendix.
  Provider secrets have a separate storage abstraction (`app/secrets.py` and
  `ProviderSecret`); they are not trip content or export material.
- **Application-controlled storage:** media/document originals, generated image
  and video copies/posters, and owner-library files. The database records keys,
  hashes, sizes and types, not file bytes. `storage.py` and the object-storage
  contract require write/fsync/rename before row commit, no mutation of a
  referenced key, committed `purge_pending` before deletion, and the shared
  deletion lock. Failed writes/transactions can leave unreferenced files;
  reconciliation considers only old unreferenced files, not rows in any state.
- **Device-local unsaved edits:** capture drafts use unencrypted `localStorage`
  (`frontend/src/tracker-model.ts:530,782–824`), keyed by trip rather than owner.
  Tab recovery uses owner/path/baseline keys in `sessionStorage`
  (`forms/record-recovery.ts:14–42`), with serializable values and no upload bytes.
  Neither is canonical server data or automatically part of an owner export.
- **Explicit private offline pins:** encrypted IndexedDB stores keys, generations
  and selected copies (`offline/offline-store.ts:10–60`). Supported kinds include
  documents, emergency entries, originals/copies, route snapshots, visits and
  packing lists. Seven-day lease, reconnect authorization and logout wipe apply;
  pins are cached reads, not an outbox. No durable access token is required.
- **Other browser state:** saved unlisted links (`saved-shared-trips.ts`) retain
  capabilities as device-local bookmarks, not trip files; the policy reconciliation
  is already tracked in [#108](https://github.com/tjorim/travel/issues/108).
  App-shell caching does not authorize caching private API bodies. No provider
  map tiles belong in private route snapshots.

## Forms Versus Authenticated MCP

Both entry points act as the authenticated subject. MCP resolves a verified token
subject (`mcp_server.py:278–290`), with a configured development-only fallback;
HTTP uses `auth.current_subject`. Neither accepts a subject in a mutation payload.
`routers/trips.py:95–101` filters the trip and subject together. Nested lookups
remain inside that trip; library lookups filter direct ownership
(`routers/library.py:58–79`). Cross-subject editing is not a supported feature.

The MCP adapter invokes the HTTP domain functions rather than issuing an HTTP
request. Pydantic payloads are shared, but FastAPI parameter/dependency validation
is therefore **not** automatically shared. `schemas.py:114–130` forbids unknown
fields and validates safe text for model payloads; annotations on an HTTP path,
query or multipart parameter need separate review.

| Mutation family | Shared path / evidence | Assessment |
| --- | --- | --- |
| Trip, visit, update | MCP `:489–678` calls routers with `TripCreate/Update`, `VisitCreate/Update`, `TravelUpdateCreate/Patch` | Same domain/date/place/attachment rules |
| Area/location save, edit, merge, delete | MCP `:721–868`; routers `areas.py`, `locations.py`, `placement.py` | Same place resolution and visitor-change/widening review; no automatic provider suggestion save |
| Visibility / public scope / link lifecycle | MCP `:870–1077`; `routers/visibility.py:29–91`, publication handlers `:173–666` | Same readiness, custom-scope cleanup, publication and capability rules; same access-change audit |
| Media import, upload, generation, approval, presentation, delete | MCP `:1080–1171,1627–1683`; media routers/services | Same checksum, dedup, review and purge services; binary adapter differences below |
| Documents/library and emergency data | MCP `:1173–1245,1696–1760`; document/library routers and services | Same ownership/file lifecycle; multipart title-validation gap below |
| Stays/routes/tasks/packing | MCP `:1249–1625`; corresponding routers | Shared typed inputs, links, ordering and domain checks for exposed tools; incomplete tool coverage below |

### Divergences And Reproduction

These are the divergences found in this source review, including intentional
transport differences. This is not a claim of exhaustive runtime equivalence.
Line numbers refer to the reviewed source; tests listed here already exist unless
explicitly described as a proposed reproduction. No new test is added in this PR.

1. **Upload metadata bypass (defect, #115).** MCP document and library upload
   accept plain `str` titles (`:1173–1187,1696–1710`); HTTP uses
   `SafeText` with multipart length 1–160 (`routers/documents.py:64`,
   `routers/library.py:88`). Direct service functions store title without those
   checks (`document/service.py:16–47`, `library/service.py:68–101`). Reproduce
   with fresh synthetic file bytes per upload, title empty, 161 characters or
   unsafe text: HTTP should return 422 before storage; MCP bypasses the Form
   check. PostgreSQL may reject a too-long string at commit while SQLite may
   retain it. This reproduction has not been executed; do not depend on a
   database error as validation. File writes can precede failure.
2. **Audit is different, and best effort (#116).** MCP `_call` (`:406–451`)
   audits successful reads as well as writes and rejections in a separate
   transaction. `_record_audit` (`:329–357`) logs failures and still returns a
   completed operation as success. Forms have shared publication/visibility
   events, not a general per-invocation equivalent. Invalid authenticated MCP
   arguments are audited (`:359–379`); unauthenticated calls have no owner audit.
   `audit.py:70–80` purges only `AuditEvent`, leaving MCP history unbounded.
   Existing reproductions: `test_committed_delete_is_reported_successful_if_audit_write_fails`,
   `test_invalid_arguments_are_audited_without_the_payload`, and
   `test_delete_trip_retains_success_and_rejection_audits` in `test_mcp_server.py`.
   There is no atomic mutation-plus-MCP-audit guarantee.
3. **Confirmation is an adapter contract.** MCP requires `confirm` for deletes,
   approval and explicit visibility/publication/link access operations
   (`:293–297,578–589,870–887,926–956,1021–1066,1143–1171`). HTTP handlers
   trust the authenticated mutation and the UI supplies confirmation dialogs.
   Create/update payloads can also change visibility without this extra MCP
   boolean; their shared publication validation/audit still runs. Reproduce
   using `test_set_visibility_tool_needs_confirmation_and_uses_the_owner_rules`
   and compare a valid typed update containing visibility. The boolean is an
   acknowledgement, not evidence of a human reviewing a preview. Merge and
   location visitor-change acknowledgements are shared domain checks, stronger
   than the adapter's generic confirmation.
4. **Batch transaction versus form requests.** `batch_create` (`:522–565`)
   temporarily changes per-record commits to flushes and commits once. Forms
   create individual rows in individual transactions. Existing reproduction:
   `test_batch_create_adds_everything_or_nothing`. The batch supports only
   visits/stays/routes/updates/tasks, not file ingestion; preserve that boundary
   if moving commit control into a shared service in future.
5. **Binary transport and output differences (intentional, #84).** MCP retains
   encoded JSON and decodes base64 into a temporary file (`:77–104`), then calls
   the same bounded ingestion service. HTTP uses multipart. Response/status and
   headers such as `Retry-After` are not returned as HTTP metadata by MCP;
   `_call` translates handler HTTP exceptions into tool errors (`:429–435`).
   MCP compact lists and removal of `*_html` (`:107–185`) differ from full form
   responses but retain Markdown source. Do not use a compact list as an export.
6. **Coverage is not identical.** The MCP method inventory lacks packing-template
   save/delete and packing-source/suggestion tools (`routers/packing.py:224–310`),
   derivative retry (`routers/media.py:333–357`), provider credential mutation/
   OAuth (`routers/media.py:551–602`), and Markdown/translation helpers.
   Trip lists omit HTTP search/pagination arguments; updates can be read nested
   in trip responses rather than through the dedicated HTTP list filters.
   Preview file tools inspect metadata rather than returning file bytes.
   These are capability differences, not alternate unsafe mutation paths.
   Provider credential transfer should remain outside generic editing tools.
   Any additional parity work needs an owner choice under #119 rather than
   indiscriminately exposing every endpoint.

Existing regression evidence also includes `test_mcp_cannot_cross_owner_boundary`,
`test_route_tools_refuse_a_route_between_the_same_place`, the merge-widening and
chosen-private tests, and `test_update_location_refuses_an_unacknowledged_visitor_change_with_a_json_review`.
These are source-inspected tests, not tests executed for this documentation PR.
A practical rerun is `cd backend && uv sync --all-groups --frozen && uv run pytest tests/test_mcp_server.py`.

## Retention, Deletion And Private Export

Decision 36 retains active data until owner deletion, permits recoverable sealed
copies for at most 30 days and backup retention up to 90 days. It does not
promise an undo action for every record. Most structured records are hard
deleted. Media originals are soft deleted (`media/service.py:741–761`), disappear
from live reads, and later purge together with derivatives (`:783–815`).
Trip documents (`document/service.py:50–60`), library documents
(`library/service.py:128–137`) and generated derivatives (`media/service.py:764–780`)
are hard deleted with committed pending-object cleanup and locked physical purge.
Shared/deduplicated objects must survive while any live reference remains.

Trip deletion (`routers/trips.py:155–158`) currently commits row deletion without
queuing object cleanup. `StoredObject.trip_id` cascades (`models.py:875`), so
normal pending-row purge loses inventory and old files need orphan reconciliation.
Track the cleanup/retry and remote-job boundary in #117; reproduce using a local
PostgreSQL trip with synthetic media/documents, delete over each entry point,
then compare inventory, worker state and storage before/after maintenance.
This was source-reviewed, not executed against PostgreSQL. Owner documents use
`SET NULL` on their trip link and must not be deleted with that trip.

Sharing audit expires at 730 days (`audit.py:34,70–80`); MCP audit has no equivalent
purge (#116). Maintenance accepts any positive media retention duration
(`maintenance.py:20–34`), not a maximum of 30; actual scheduler configuration must
honor policy. Production scheduling, backup expiry/encryption and restore
revocation replay were **not verified** in this checkout; apps#245 and the
object-storage contract supply the infrastructure context, not runtime evidence.
Device pins expire by lease and are wiped on logout; deletion on an offline
device is bounded by that lease, not instantaneous remote erasure. Capture
owner isolation and legacy draft handling need #118.

A per-trip owner export (#119, feeding A3) must start from authorized canonical
rows, not a visitor projection, a database dump or browser state. Proposed
boundary, pending owner decision:

- Versioned manifest with trip and relationship IDs, typed dates/time zones,
  authored Markdown, structured planning records and file checksums; preserve
  links without exporting private storage keys as portable filenames.
- Explicitly choose originals/raw metadata, approved copies and deleted content;
  default to live trip-owned content. Include linked library documents only by
  explicit choice; exclude unrelated library/emergency/template data.
- Exclude bearer/provider tokens, raw share capabilities, capability verifiers,
  internal worker/source keys and device drafts/pins. Decide whether to include
  access policy and bounded audit history as separate sensitive manifest parts.
- Define a consistent snapshot under concurrent edits and file deletion, bounded
  streaming/temp-storage cleanup and export expiry. An export is sensitive owner
  output; it cannot be served on `/trips/` or `/share/`, and cannot promise remote
  revocation after download. Public static export is a different product decision.

## Proposed Changes In Value Order

Sizes: S is a focused change, M spans services/tests, L needs a new workflow.
Implementation is deliberately outside this documentation-only PR.

| Order | Change / tracking | Size | Owner decision |
| --- | --- | --- | --- |
| 1 | [#115](https://github.com/tjorim/travel/issues/115): share document-upload metadata validation before file writes | S | No; existing HTTP constraints are the contract |
| 2 | [#117](https://github.com/tjorim/travel/issues/117): preserve retryable trip-object cleanup and cancel worker work | M | No for cleanup correctness; confirm any new recovery promise separately |
| 3 | [#118](https://github.com/tjorim/travel/issues/118): owner-isolate capture drafts, quarantine legacy drafts and handle storage failure | M | Decide logout/recovery UX; do not silently assign legacy data |
| 4 | [#116](https://github.com/tjorim/travel/issues/116): bound MCP audit retention and state the durability guarantee | M | Yes: retention period and whether best effort is acceptable |
| 5 | [#119](https://github.com/tjorim/travel/issues/119): approve owner-export boundary, reconcile decision 37 with current schema, then implement export | L | Yes: originals/deleted rows/library/audit scope and artifact retention; choose any missing MCP capabilities explicitly |
| 6 | [#84](https://github.com/tjorim/travel/issues/84): avoid encoded JSON allocation for large MCP files | M | Transport compatibility decision; existing issue reused |

No issue #94 edits or GitHub comments were made. Existing #108 covers saved-link
policy reconciliation. No schema redesign is justified simply to make historical
logical-schema prose match the implementation.

## Verification Limits

Static review covers the requested docs, models, schemas, projection, MCP adapter
and owner/publication routers with their called storage services. There is no
`backend/app/publication.py`; publication lives in `routers/publication.py`.
Frontend locked installation and formatting pass on Node 24.14.0 using the package's
pinned pnpm 10.33.0. No backend tests were modified or executed, no browser/device
visual review was required, and no production credentials, private records or
provider calls were used. Runtime cross-transport reproductions above and actual
VPS retention/restore behavior remain unverified. This PR changes no public,
unlisted or owner route behavior and no UI dependency/shared component.

## Mapped Field Inventory

Every mapped column below is stored in the database. Foreign keys name the
relationship; file bytes live separately. Types, enum domains, constraints and
JSON validation remain authoritative in `models.py` and `schemas.py`.

- **ProviderSecret** ([models.py:80](../../backend/app/models.py#L80)): `subject`, `provider`, `kind`, `ciphertext`.

- **Area** ([models.py:219](../../backend/app/models.py#L219)): `visibility`, `id`, `trip_id` → trips.id, `label`, `region`, `country_code`, `latitude`, `longitude`, `timezone`, `created_at`, `updated_at`.

- **Location** ([models.py:247](../../backend/app/models.py#L247)): `visibility`, `id`, `trip_id` → trips.id, `area_id` → areas.id, `label`, `share_address`, `osm_element_type`, `osm_element_id`, `osm_url`, `display_name`, `address_line1`, `address_line2`, `locality`, `admin_area`, `postal_code`, `country_code`, `latitude`, `longitude`, `viewport_north`, `viewport_south`, `viewport_east`, `viewport_west`, `navigation_provider`, `navigation_provider_place_id`, `notes`, `created_at`, `updated_at`.

- **Trip** ([models.py:309](../../backend/app/models.py#L309)): `id`, `owner_subject`, `title`, `summary`, `starts_on`, `ends_on`, `created_at`, `updated_at`.

- **TravelUpdateMediaAsset** ([models.py:374](../../backend/app/models.py#L374)): `travel_update_id` → travel_updates.id, `media_asset_id` → media_assets.id, `created_at`.

- **TravelUpdate** ([models.py:394](../../backend/app/models.py#L394)): `visibility`, `id`, `share_id`, `trip_id` → trips.id, `area_id` → areas.id, `location_id` → locations.id, `occurred_at`, `date_precision`, `title`, `body`, `private_notes`, `created_at`, `updated_at`.

- **Stay** ([models.py:443](../../backend/app/models.py#L443)): `visibility`, `id`, `trip_id` → trips.id, `location_id` → locations.id, `check_in_date`, `check_out_date`, `check_in_time`, `check_out_time`, `status`, `property_name`, `website_url`, `booking_reference`, `contact_details`, `notes`, `share_date_precision`, `created_at`, `updated_at`.

- **Route** ([models.py:493](../../backend/app/models.py#L493)): `visibility`, `id`, `trip_id` → trips.id, `mode`, `status`, `label`, `departure_area_id` → areas.id, `arrival_area_id` → areas.id, `departure_location_id` → locations.id, `arrival_location_id` → locations.id, `departs_on`, `departs_at`, `arrives_at`, `departure_timezone`, `arrival_timezone`, `carrier`, `service_reference`, `travel_class`, `booking_reference`, `notes`, `geometry`, `created_at`, `updated_at`.

- **RouteDocumentAsset** ([models.py:566](../../backend/app/models.py#L566)): `route_id` → routes.id, `document_asset_id` → document_assets.id, `created_at`.

- **Visit** ([models.py:587](../../backend/app/models.py#L587)): `visibility`, `id`, `trip_id` → trips.id, `position`, `area_id` → areas.id, `location_id` → locations.id, `title`, `kind`, `status`, `starts_on`, `ends_on`, `start_time`, `end_time`, `notes`, `summary`, `share_time`, `share_date_precision`, `created_at`, `updated_at`.

- **PackingList** ([models.py:645](../../backend/app/models.py#L645)): `id`, `trip_id` → trips.id, `name`, `created_at`.

- **PackingTemplate** ([models.py:657](../../backend/app/models.py#L657)): `id`, `owner_subject`, `name`, `snapshot`, `created_at`.

- **PackingBag** ([models.py:667](../../backend/app/models.py#L667)): `id`, `list_id` → packing_lists.id, `name`, `type`, `position`, `weight_limit_g`.

- **PackingItem** ([models.py:682](../../backend/app/models.py#L682)): `id`, `list_id` → packing_lists.id, `bag_id` → packing_bags.id, `label`, `quantity`, `category`, `packed`, `position`, `essential`, `last_minute`, `valuable`, `cabin_only`, `checked_only`, `notes`, `weight_g`.

- **TripTask** ([models.py:709](../../backend/app/models.py#L709)): `id`, `trip_id` → trips.id, `title`, `notes`, `due_date`, `remind_at`, `reminded_at`, `links`, `completed_at`, `created_at`, `updated_at`.

- **TripTaskAlert** ([models.py:739](../../backend/app/models.py#L739)): `id`, `task_id` → trip_tasks.id, `owner_subject`, `kind`, `title`, `scheduled_for`, `created_at`, `read_at`, `email_sent_at`, `email_attempts`, `email_last_error`.

- **PublicSurface** ([models.py:758](../../backend/app/models.py#L758)): `trip_id` → trips.id, `slug`, `state`, `revision`, `scope`, `created_at`, `updated_at`.

- **ShareLink** ([models.py:781](../../backend/app/models.py#L781)): `id`, `trip_id` → trips.id, `label`, `series_id`, `state`, `revision`, `scope`, `token`, `token_verifier`, `expires_at`, `created_at`, `updated_at`, `activated_at`, `revoked_at`.

- **AuditEvent** ([models.py:812](../../backend/app/models.py#L812)): `id`, `trip_id` → trips.id, `actor_subject`, `kind`, `target_type`, `target_id`, `occurred_at`, `details`.

- **McpAuditEvent** ([models.py:834](../../backend/app/models.py#L834)): `id`, `owner_subject`, `action`, `resource_type`, `resource_id`, `trip_id`, `result`, `occurred_at`, `details`.

- **StoredObject** ([models.py:861](../../backend/app/models.py#L861)): `id`, `trip_id` → trips.id, `bucket`, `object_key`, `sha256`, `byte_size`, `content_type`, `state`, `created_at`, `updated_at`.

- **ImportSession** ([models.py:890](../../backend/app/models.py#L890)): `id`, `trip_id` → trips.id, `provider`, `provider_session_id`, `state`, `created_at`, `expires_at`.

- **ImportRecord** ([models.py:912](../../backend/app/models.py#L912)): `id`, `trip_id` → trips.id, `provider`, `provider_item_id`, `state`, `media_asset_id` → media_assets.id, `requested_at`, `completed_at`, `failure_code`.

- **MediaAsset** ([models.py:942](../../backend/app/models.py#L942)): `id`, `trip_id` → trips.id, `original_object_id` → stored_objects.id, `media_kind`, `captured_at`, `captured_local`, `import_id` → import_records.id, `raw_metadata`, `created_at`, `updated_at`, `deleted_at`.

- **MediaDerivative** ([models.py:973](../../backend/app/models.py#L973)): `visibility`, `id`, `trip_id` → trips.id, `media_asset_id` → media_assets.id, `object_id` → stored_objects.id, `poster_object_id` → stored_objects.id, `processing_state`, `processing_backend`, `processing_started_at`, `remove_audio`, `duration_seconds`, `purpose`, `metadata_stripped_at`, `review_state`, `width`, `height`, `travel_update_id` → travel_updates.id, `caption`, `alt_text`, `focal_x`, `focal_y`, `is_cover`, `created_at`.

- **DocumentAsset** ([models.py:1037](../../backend/app/models.py#L1037)): `id`, `trip_id` → trips.id, `original_object_id` → stored_objects.id, `document_kind`, `title`, `owner_metadata`, `created_at`, `updated_at`, `deleted_at`.

- **OwnerStoredObject** ([models.py:1060](../../backend/app/models.py#L1060)): `id`, `owner_subject`, `bucket`, `object_key`, `sha256`, `byte_size`, `content_type`, `state`, `created_at`, `updated_at`.

- **OwnerDocument** ([models.py:1089](../../backend/app/models.py#L1089)): `id`, `owner_subject`, `original_object_id` → owner_stored_objects.id, `document_kind`, `title`, `owner_metadata`, `linked_trip_id` → trips.id, `created_at`, `updated_at`, `deleted_at`.

- **EmergencyInfoEntry** ([models.py:1120](../../backend/app/models.py#L1120)): `id`, `owner_subject`, `kind`, `label`, `value`, `notes`, `created_at`, `updated_at`.

- **MediaWorkerJob** ([models.py:1143](../../backend/app/models.py#L1143)): `id`, `derivative_id` → media_derivatives.id, `worker_id`, `profile`, `remove_audio`, `source_key`, `source_sha256`, `state`, `attempts`, `next_attempt_at`, `error_code`, `created_at`.
