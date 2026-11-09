# Trip Export Format

Schema `travel/trip-export@1`. Implements [#119](https://github.com/tjorim/travel/issues/119)
under owner decision 2026-11-01: **JSON records only**, no files.

`GET /api/trips/{trip_id}/export` (owner session or token, like every owner route)
streams one JSON document as an attachment (`Cache-Control: private, no-store`).
The trip is authorized from the authenticated subject only; another owner's
trip, or an unknown id, is `404`. The endpoint is private owner output: it is not
served on `/trips/` or `/share/` and is not a public static archive. The UI action
is "Export trip data (JSON)" in the trip's details dialog.

## Document

```json
{
  "schema_version": "travel/trip-export@1",
  "exported_at": "2054-05-01T09:00:00+00:00",
  "trip": {},
  "areas": [], "locations": [], "visits": [], "stays": [], "routes": [],
  "alternative_groups": [],
  "travel_updates": [], "media_assets": [], "media_derivatives": [],
  "import_records": [], "documents": [], "tasks": [], "packing_lists": [],
  "publication": { "public_surface": null, "share_links": [] }
}
```

Dates, times and instants are ISO 8601 strings; identifiers are the opaque ids
used by the API, so relationships are plain id references:

- `locations[].area_id`, `visits[].area_id/location_id`, `stays[].area_id/location_id`,
  `routes[].departure_/arrival_ area_id and location_id`,
  `travel_updates[].area_id/location_id`.
- `stays[].document_ids`, `routes[].document_ids` and
  `travel_updates[].media_asset_ids` list the associated documents and media
  assets by id.
- `media_derivatives[].media_asset_id/travel_update_id`, `media_assets[].import_id`.
- `packing_lists[]` nest their `bags` and `items`; `items[].bag_id` points at a bag.

`alternative_groups[]` lists the owner's private groups of stays, visits or routes
being compared (see [the domain model](domain-model.md#alternatives)): `id`,
`kind` (`stay`, `visit` or `route`), `label`, `created_at`, `updated_at` and
`members[]` as `{ "record_id", "chosen" }`, where `record_id` is the id of an
entry in `stays`, `visits` or `routes` of that kind and at most one member is
`chosen`. The section is new in this version of the export and was added without
changing the schema version, because adding a section is compatible; an
importer that ignores unknown keys loses only the grouping, and the records keep
the statuses the choice gave them.

A stay always has an `area_id`; its `location_id` is `null` while the
accommodation is not chosen yet (the stay is filed under its area alone, with no
placeholder location). When both are present the location lies in that area.
`stays[].area_id` was added without changing the schema version, because adding
a field is compatible; a consumer that assumed `stays[].location_id` is never
`null` must now handle `null` and can read the area from `stays[].area_id`.

`stays[].document_ids` (the documents attached to a stay, such as its booking
confirmation; [#257](https://github.com/tjorim/travel/issues/257)) was added
without changing the schema version, because adding a field is compatible; a
consumer that ignores unknown keys loses only the attachments. It is always
present (an empty list for a stay without documents), orders the ids by when
they were attached, and omits soft-deleted documents, like `routes[].document_ids`.

Each record lists its columns explicitly in `backend/app/export.py`. A column
added to a model later is **not** exported until reviewed and added there.
Records are ordered stably (creation time or position, then id). The document
is generated section by section from a single database snapshot (PostgreSQL
`REPEATABLE READ`), so concurrent edits never produce a mixed view, and a large
trip is never materialised at once (rows are read in batches of 200; a packing
list is held in memory one list at a time).

## Included

Trip (without `owner_subject`), areas, locations (including addresses, exact
coordinates and notes), visits, stays (with booking details), routes (with
geometry), travel updates (including `private_notes` and `share_id`), tasks,
packing lists, and publication settings as owner data: the public page state,
revision, slug and scope, and each share link's label, state, revision, scope
and expiry; the public page and each link also carry `applied_preset` and
`applied_preset_at`, the sharing preset last applied (a display label only; null
when none was). Media assets and derivatives and documents are **metadata only**,
for live (not soft-deleted) rows: kind, capture time, raw EXIF metadata, review
and processing state, caption, and for each file `sha256`, `byte_size`,
`content_type` and `state`. Import records keep provider, provider item id and
state. The checksums let a later files export be verified; they are not keys.

## Excluded

Excluded by design, and covered by canary tests in `backend/tests/test_export.py`:

- File bytes of originals, derivatives, posters and documents.
- Storage buckets, object keys and object paths, including worker job source keys.
- Share-link tokens, capability URLs and verifiers; provider tokens and secrets;
  provider session handles (import sessions are not exported).
- Other owners' data and any owner-wide record: library documents (even linked to
  this trip), emergency information and packing templates.
- Visitor projections and other derived views (agenda, map viewports, rendered
  Markdown, thumbnails).
- Soft-deleted media and documents, and trip task alerts (notification state).
- Sharing audit events and MCP audit rows. The export itself is recorded in the
  MCP audit table (see below).

## Audit

Each successful request writes one `McpAuditEvent` row (`action: trip.export`,
`resource_type: trip`, the trip id, `result: success`, details
`{"schema_version", "transport": "http"}`) and a log line with the trip id. No
payload, filename or content is recorded. The row follows the existing 730-day
retention and is written before the response starts; if it cannot be written the
export does not start. A client that disconnects mid-stream still counts as a
request.

## Versioning

`schema_version` changes only for incompatible changes (removed or renamed
fields, changed meaning). Adding a field or section is compatible; consumers
must ignore unknown keys.

## MCP

No MCP tool is added: MCP tool results are fully buffered JSON, which defeats
the streaming bound, and `get_trip` and the list tools already give assistants
equivalent per-kind reads. A files export is a possible follow-up.

## On-demand PDF (#248)

`POST /api/trips/{trip_id}/export/pdf` is owner-only, with a JSON body:

```json
{"content":"both","view":"audience","audience":"public","locale":"nl"}
```

`content` is explicitly `story`, `itinerary` or `both`; `locale` is `nl` or
`en`. `view` is `audience` with `audience: "public"` or a trip-owned share-link
id or `collection:<member_id>` for a trip-owned collection member, or `private` with `confirm_private: true` and no audience. The UI offers
these choices under **Export as PDF** in trip details, without defaulting to
private output. It exports **saved** data, preserving any unsaved editor draft.
A hidden, expired or revoked audience can still be selected by its owner: this
is a preview of its saved scope, not a claim that its visitor URL is live.
Collection-member scopes are checked against both the trip and collection owner.

Audience input is the exact `render_projection` document used by the visitor
view/preview: visibility, exclusions, dependent-photo gating and date precision
are applied before PDF layout. The PDF is a text/photo rendition, not a copy of
the interactive map or navigation controls. A separate display-field allowlist
also rejects private/unknown fields at the renderer boundary. Photos resolve
only projection-local image ids through `scoped_file`; no original, video,
poster, document, remote image, link destination or authored URL is fetched.
Markdown is printed as escaped source text, never executable PDF layout markup.

Private output includes all story updates and their private notes, approved
share-photo copies (including private ones), and itinerary visits, stays,
routes and location details, including booking/contact information and notes.
It does not embed originals, videos or document files, or include unrelated
packing lists, tasks, emergency/library records or publication credentials.
The private choice requires acknowledgement and the file repeats its warning.
Either view produces a portable copy that later revocation cannot erase.

Generation uses a repeatable-read snapshot on PostgreSQL. Before ORM relations
load, database aggregates cap the trip at **1500 trip-owned rows** and
**500,000 stored characters**, including metadata, scopes and audit rows; this
conservative whole-trip limit applies even to a smaller content selection.
Photo limits are **60 copies**, **10 MiB per encoded photo**, **64 MiB total**
and **20 million pixels per decoded image**. Copies are staged in 64 KiB chunks;
the renderer downsamples each to at most 1600×1600. There are **two active
exports per API process**, including delivery; saturation returns 503 with
`Retry-After: 5`. PostgreSQL statements have a 5-second timeout. Snapshot queries, preparation
and rendering share a 30-second deadline (an in-flight PostgreSQL statement
may add up to five seconds), with a
separate worker constrained to 25 CPU seconds, 512 MiB address space and a
64 MiB output file. Preflight bounds parent allocations; the worker hard
memory limit also bounds image decoding and ReportLab's buffered document.
The deadline is checked before each snapshot query and staged chunk; a query
already in flight is bounded by its statement timeout.

The finished PDF streams in 64 KiB chunks with `Cache-Control: private,
no-store`. It is generated into an automatically removed private temporary
directory, never an object-storage row/key, query-cache entry or permanent
server artifact. Cleanup releases admission on rendering, database or audit
failure, completed delivery and disconnect. Temporary disk needs include
encoded copies, normalized images and output, bounded by the limits above;
process termination relies on the host's temporary-directory housekeeping.
A successful generation writes a payload-free `McpAuditEvent` with
`action: trip.export_pdf`, trip/resource id, `result: success`, and only
`{"transport":"http"}` as details before starting delivery. Disconnect still
counts as a request; audit failure prevents delivery.

### Dependency and layout review

ReportLab **5.1.0** is pinned in `pyproject.toml` and `uv.lock` (BSD-licensed
Python package; Pillow was already a runtime dependency, charset-normalizer is
locked transitively). Its [Platypus flowables](https://docs.reportlab.com/reportlab/userguide/ch5_platypus/)
split long paragraphs across pages and scale local images. Its
[paragraph API](https://docs.reportlab.com/reportlab/userguide/ch6_paragraphs/)
accepts XML and remote image sources, so **all authored text is escaped** and
images are passed separately from server-controlled local paths. No HTML/CSS
browser, shell command, font URL or arbitrary URL fetching is involved.
[Embedded TrueType fonts](https://docs.reportlab.com/reportlab/userguide/ch3_fonts/)
use the package's bundled Bitstream Vera regular/bold files: Dutch/English
Latin accents work without an OS font installation. Other scripts and emoji
are not guaranteed. The production Docker image was built and the packaged
fonts/rendering checked as its unprivileged user; no Dockerfile font package
is needed.

PDFs provide selectable text, title/language metadata, page numbers, headings,
reader bookmarks and visible photo descriptions. They are **not tagged
PDF/UA**, and visible descriptions are not structural image alternative text.
Do not describe them as fully accessible; the accessible application remains
available. Synthetic long-text, portrait/landscape-photo samples are generated
outside Git and reviewed using Poppler rasterization and text extraction.

Full structural tagging is tracked in [#321](https://github.com/tjorim/travel/issues/321).

## Live location exception (#244, 2026-11-09)

The owner explicitly approved exact live-track storage and current-only audience
sharing. Earlier blanket no-GPS-history/live-location statements are superseded
only by [decision 244](decisions/244-live-location-tracks.md).
Tracks stay owner-only until explicit deletion; freshness expiry preserves them.
Review each enabled audience and its delivered precision before sharing. Live
coordinates and tracks are excluded from PDF, Atom and ordinary trip exports;
owner track export is a separate deliberate download. Database and HA backups
may retain deleted history until their independent retention expires.
