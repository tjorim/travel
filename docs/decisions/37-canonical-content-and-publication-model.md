# Travel canonical content and publication model

Issue [#37](https://github.com/tjorim/travel/issues/37) defines the v1 model
for the private Travel application and the controlled path to a public archive.
It implements, and is subordinate to, the [privacy, sharing, and offline
policy](36-privacy-sharing-offline-policy.md). It is a design contract, not an
instruction to replace the tracker MVP tables in place.

## Decisions

- The application database is the sole canonical source for structured travel
  content and access policy. Application-controlled object storage on the
  backed-up VPS is the sole canonical source for files. Git contains software,
  infrastructure, schemas, documentation, and fixtures only.
- Every canonical row belongs directly or transitively to one `trip`, and that
  trip has exactly one `owner_subject`: the authenticated OIDC `sub`. There are
  no recipient, collaborator, group, or viewer rows in v1.
- Exact and broad representations are distinct records. A broad label,
  generalized line, moment excerpt, media derivative, or redacted document is
  authored/approved output; it is never calculated in a browser from canonical
  private data.
- Owner, public, and unlisted APIs serialize three separately versioned
  contracts. A public or unlisted handler starts at an active projection and
  never loads a full owner payload to redact it.
- Static files are only generated for the public audience. Unlisted pages and
  their files stay behind a capability-checking application delivery layer, so
  revocation remains effective.

`v1` means the first application-backed model. Existing `api/app/models.py`
and `dist/` files are a limited legacy/MVP implementation, not this model's
schema authority.

## Versioning and common conventions

The database records a `schema_version` on each JSON-bearing resource and on
every generated representation. Version identifiers use `travel/<resource>@<n>`
(for example, `travel/trip@1`). A newer reader may migrate an earlier version
on the server; it must never infer a projection from a changed canonical row.
Breaking changes add a version and an explicit migration. The `id` columns are
opaque 128-bit-or-stronger random identifiers, not sequential identifiers and
not public identifiers.

Every canonical resource has these columns unless noted otherwise:

| Column | Meaning |
|---|---|
| `id` | Opaque primary key. |
| `trip_id` | Owning trip; omitted only for a trip itself. |
| `schema_version` | Contract version of its structured payload. |
| `created_at`, `updated_at`, `deleted_at` | UTC lifecycle timestamps; `deleted_at` supports the bounded recoverable-deletion policy. |
| `created_by_subject`, `updated_by_subject` | Owner subject used for an owner-only audit trail. |

Rows that contain opaque encrypted application data use a `payload` JSON column
whose allowed shape is named below. Queryable/security-relevant fields remain
typed columns, rather than being hidden in `payload`. Object keys, owner
subjects, provider IDs, raw metadata, exact geometry, and other restricted
values never appear in any shared-contract JSON.

## Canonical relational model

The following tables are the logical schema for a future Alembic migration.
Foreign keys to trip-owned resources use `ON DELETE CASCADE`; object deletion is
an asynchronous, audited purge after the database transaction.

| Resource / schema | Required typed fields and relationships | Private payload and constraints |
|---|---|---|
| `trip` (`travel/trip@1`) | `id`, `owner_subject`, `slug`, `title`, `summary`, `start_on`, `end_on`, `baseline_visibility` (`private` or `public`) | A trip starts `private`; `slug` is reserved globally to preserve a public URL when one is later published. |
| `place` (`travel/place@1`) | `id`, `trip_id`, `kind` (`exact` or `broad`), `parent_exact_place_id` nullable | Exact places hold address parts, coordinates, viewport, navigation/provider IDs and optional notes. Broad places hold only deliberately chosen label, country/region and optional approved generalized point or geometry. A broad place may reference its exact source for owner traceability, but no shared response includes that reference. |
| `recorded_track` (`travel/recorded-track@1`) | `id`, `trip_id`, `source_object_id`, `started_at`, `ended_at`, `kind` | The source object contains raw points/times/speed/elevation. A separately authored `broad_route` is needed to share a line or stages; rounding a raw track at request time is forbidden. |
| `broad_route` (`travel/broad-route@1`) | `id`, `trip_id`, `label`, `geometry`, `date_precision` | Stores an owner-reviewed generalized route line and/or ordered broad-place references. It may be selected by a projection; raw track IDs and point timestamps stay owner-only. |
| `stay` (`travel/stay@1`) | `id`, `trip_id`, `exact_place_id`, `arrives_at`, `departs_at`, `status` | Holds property name, booking/contact references, exact dates and notes. A shareable stay card is a separate `broad_stay_card`, never a selection of this row. |
| `broad_stay_card` (`travel/broad-stay-card@1`) | `id`, `trip_id`, `broad_place_id`, `title`, `date_precision` | Contains only owner-authored city/region text and approved date precision. It cannot reference a stay in a shared representation. |
| `route_stage` (`travel/route-stage@1`) | `id`, `trip_id`, `position`, `broad_place_id`, `arrives_on`, `departs_on` | Ordered unique `(trip_id, position)`; optional owner-only transport/note data. It always points to a broad, not exact, place so the chosen shared stage is explicit. |
| `moment` (`travel/moment@1`) | `id`, `trip_id`, `occurred_at`, `exact_place_id` nullable, `title`, `body` | Full owner journal/moment text and private links. It is not itself shareable. |
| `moment_excerpt` (`travel/moment-excerpt@1`) | `id`, `trip_id`, `source_moment_id` nullable, `broad_place_id` nullable, `date_precision`, `title`, `body` | A standalone approved excerpt. `source_moment_id` is owner-only provenance and optional so an excerpt can outlive a deleted journal item; it is absent from share output. |
| `stored_object` (`travel/stored-object@1`) | `id`, `trip_id`, `bucket`, `object_key`, `sha256`, `byte_size`, `content_type`, `encryption_key_ref`, `state` | Object storage inventory. Keys are application-only; `state` is `staged`, `available`, `quarantined`, or `purge_pending`. Deduplication never crosses owners. |
| `media_asset` (`travel/media@1`) | `id`, `trip_id`, `original_object_id`, `captured_at`, `exact_place_id` nullable, `media_kind`, `import_id` | Raw EXIF/XMP/IPTC, camera data, people/face tags, captions and provenance are owner-only. `original_object_id` always points to a VPS copy. |
| `media_derivative` (`travel/media-derivative@1`) | `id`, `trip_id`, `media_asset_id`, `object_id`, `purpose`, `metadata_stripped_at`, `review_state` | `purpose` is `owner_preview`, `share`, or `static_export`. A share/static derivative is usable only after metadata stripping and owner review; it has approved caption and alt text stored in its projection item, not raw metadata. |
| `document_asset` (`travel/document@1`) | `id`, `trip_id`, `original_object_id`, `document_kind`, `title` | Original filename, extracted text, OCR, booking data and metadata remain owner-only. |
| `document_derivative` (`travel/document-derivative@1`) | `id`, `trip_id`, `document_asset_id`, `object_id`, `redaction_manifest_object_id`, `review_state` | A possible shared file is a new, reviewed redacted derivative. No original object can be projected. |
| `import_record` (`travel/import@1`) | `id`, `trip_id`, `provider` (`direct_device`, `google_photos_picker`, `gopro_cloud`), `state`, `requested_at`, `completed_at`, `failure_code` | Owner authorization/consent time, provider item reference and transfer checksum are owner-only. Provider access tokens are held in a secret store, never in this table or a browser response. An import completes only once copied and verified in `stored_object`; provider URLs are not retained as file delivery URLs. |
| `publication_draft` (`travel/publication-draft@1`) | `id`, `trip_id`, `audience` (`public` or `unlisted`), `state`, `scope_json`, `created_from_revision_id` nullable | Mutable owner workspace. `scope_json` is validated as `travel/share-scope@1`; it may reference only approved derived/broad resources. |
| `projection_revision` (`travel/projection@1`) | `id`, `trip_id`, `audience`, `version`, `state`, `scope_snapshot`, `representation`, `content_hash`, `reviewed_at`, `activated_at`, `withdrawn_at` | An immutable, validated snapshot made from a draft. `version` is unique per logical projection family. `representation` validates as either `travel/public-trip@1` or `travel/unlisted-trip@1`. |
| `public_surface` (`travel/public-surface@1`) | `trip_id` unique, `slug` unique, `active_projection_revision_id` nullable, `state` | The stable public URL reservation and its currently active revision. It has no capability and is deployable only while `state=published`. |
| `share_link` (`travel/share-link@1`) | `id`, `trip_id`, `label`, `token_verifier`, `projection_revision_id`, `expires_at`, `state`, `activated_at`, `revoked_at` | Owner-only `label`; verifier is a keyed one-way digest of a 256-bit capability. State is `draft`, `active`, `revoked`, or `expired`. An active link references one immutable unlisted revision and can never be broadened in place. |
| `static_export` (`travel/static-export@1`) | `id`, `public_surface_id`, `projection_revision_id`, `state`, `manifest_object_id`, `content_hash`, `generated_at`, `deployed_at`, `invalidated_at` | Tracks the generated public-only artifact; see the export contract below. |
| `audit_event` (`travel/audit-event@1`) | `id`, `trip_id`, `actor_subject`, `kind`, `target_type`, `target_id`, `occurred_at`, `details` | Owner-only audit without raw capability, recipient identity, or recipient IP. Projection/link activity follows the 24-month policy retention. |

Database constraints enforce that every referenced resource belongs to the same
trip as the referencing row, a projection revision has one audience, an active
public surface references an active public revision, and an active link
references an active unlisted revision. The service also validates the scope;
foreign keys alone cannot make a nested projection safe.

## Versioned representation contracts

These are the complete field sets permitted to leave the owner boundary. They
are schemas, not examples: any key not listed is rejected when a projection is
frozen. All strings are plain text after server-side sanitization; all URLs are
audience-specific delivery URLs or public export-relative URLs, never object
keys or provider URLs.

### `travel/share-scope@1`

```json
{
  "schema_version": "travel/share-scope@1",
  "trip": {"title": true, "summary": true, "date_precision": "month"},
  "items": [
    {"kind": "route_stage", "id": "opaque-id", "fields": ["label", "date"]},
    {"kind": "broad_place", "id": "opaque-id", "fields": ["label", "region"]},
    {"kind": "broad_route", "id": "opaque-id", "fields": ["label", "geometry"]},
    {"kind": "moment_excerpt", "id": "opaque-id", "fields": ["title", "body", "date", "place"]},
    {"kind": "broad_stay_card", "id": "opaque-id", "fields": ["title", "date", "place"]},
    {"kind": "media_derivative", "id": "opaque-id", "fields": ["image", "caption", "alt_text"]},
    {"kind": "document_derivative", "id": "opaque-id", "fields": ["title", "file"]}
  ]
}
```

`fields` is an allowlist, not a request to expose canonical columns. The
validator rejects an item that belongs to another trip, has not passed the
required media/redaction review, is deleted, or requests a prohibited field.
Only `broad_place`, `broad_route`, `moment_excerpt`, `broad_stay_card`, and
reviewed derivatives are valid share items. Exact places, stays, raw tracks,
moments, media originals, document originals, imports and stored objects can
never occur in this schema.

### `travel/public-trip@1` and `travel/unlisted-trip@1`

Both are complete, standalone display documents produced when a projection is
frozen. They contain `schema_version`, `title`, optional `summary`, approved
date string(s), an ordered `route_stages` array, optional broad `places` and
`route`, `moments`, `stays`, `media`, and `documents`. Every display item has a
projection-local `id`, not a canonical ID. `media.image` and `documents.file`
are delivery references that identify only the approved derivative. The
unlisted form may contain a different set of approved items, but has the same
prohibited-field rules as public. It additionally carries no link label, raw
token, expiry, or internal link ID.

The server serializes these contracts from the frozen `representation` column
or export manifest; it does not serialize joins to canonical records. This
keeps later private edits from changing a published story and prevents a newly
added field from leaking through an ORM response.

## Publication and sharing state machines

| Record | States and allowed direction |
|---|---|
| `publication_draft` | `draft` -> `preview_ready` -> frozen as a revision; a change returns it to `draft`. A draft may be discarded. |
| Public `projection_revision` | `active` -> `superseded` or `withdrawn`; frozen revisions never return to a mutable state. |
| Unlisted `projection_revision` | `active` -> `withdrawn`; replacement creates another revision. |
| `public_surface` | `unpublished` -> `publishing` -> `published` -> `unpublishing` -> `unpublished`; a failed publish returns to its prior stable state. |
| `share_link` | `draft` -> `active` -> `revoked` or `expired`; `revoked` and `expired` are terminal. |
| `static_export` | `queued` -> `generated` -> `deployed` -> `invalidating` -> `invalidated`; `queued` or `generated` may instead become `failed`. |

### Public projection and static archive

1. An owner creates a `publication_draft` in `draft` and selects safe,
   separately authored resources and fields. Canonical edits do not update it.
2. The owner asks for `preview`. The service validates the share scope, renders
   the dedicated public contract, and marks the draft `preview_ready`; this is
   owner-authenticated and `no-store`.
3. On publish, the service freezes an immutable `projection_revision` as
   `active`, updates `public_surface.active_projection_revision_id`, and queues
   an export. A previous active revision becomes `superseded` after its export
   replacement is ready.
4. The exporter writes an immutable artifact set and manifest to VPS object
   storage, then deploys only that verified set to the static public origin.
   Its `static_export` moves `queued` -> `generated` -> `deployed`. The stable
   URL remains `/<slug>/`; assets use content-hashed paths.
5. Unpublish clears the active public revision, marks the surface
   `unpublished`, moves the current export to `invalidating`, removes/purges
   the origin paths and CDN cache, and records completion as `invalidated`.
   It does not change canonical data or named share links.

Only the latest successfully deployed `active` revision is served. A failed
generation/deployment is `failed` and leaves the previously active public
surface intact; an owner can retry or explicitly unpublish. Purging includes
the HTML, manifest, derivative copies, search records and all known
application-controlled cache keys. Public responses use the versioned asset
manifest and normal public cache invalidation; unpublished paths return 404.

### Unlisted capability

1. The owner prepares and previews an `unlisted` draft exactly as above.
2. Activation freezes an unlisted revision, creates a high-entropy capability,
   stores only its verifier, and creates an `active` `share_link` with an
   expiry no later than 90 days (30 days by default).
3. A capability exchange verifies state and expiry before loading the frozen
   unlisted representation or issuing short-lived derivative access. It uses
   `Cache-Control: no-store, private`, `X-Robots-Tag: noindex, noarchive`, and
   `Referrer-Policy: no-referrer`.
4. Revocation, expiry, or rotation rejects exchanges immediately, invalidates
   server sessions, signed URLs, derivatives and application caches, and moves
   the link to `revoked` or `expired`. Replacing a scope creates a new revision
   and link; it revokes the old capability before activating the replacement.

An unlisted revision is never exported as a static origin path. This is the
material distinction from public publication, not merely an instruction to
hide a static URL.

## Storage, transfer, and deletion boundary

The database stores structured records, relations, hashes, lifecycle/access
state and object metadata. VPS object storage stores originals, raw tracks,
redacted or metadata-free derivatives, export artifacts, manifests and bounded
recoverable-deletion copies. The database transaction first records a staged
object; a checksum-verified upload marks it available; only an available object
can be attached to a canonical asset or derivative.

Direct-device uploads use an owner-authorized, short-lived upload session.
Google Photos Picker and optional GoPro Cloud imports create an `import_record`;
the server copies each selected item into VPS storage, verifies its checksum,
and then creates a `media_asset`. A provider token, item identifier or remote
URL is provenance only and may not be a canonical file URL, projection field,
or fallback for failed storage. Failed/quarantined transfers cannot be shared.

Deleting a canonical resource removes it immediately from owner queries and
withdraws any active projection/export/link that references it. The purge job
then removes derivative objects, static paths, signed-url grants and caches.
The policy's 30-day sealed recovery and 90-day backup limits still apply. A
restore replays current deletion, publication, and revocation state before
serving restored data.

## Legacy archive migration

The existing `dist/<trip-slug>/public/` and protected `private/` content is a
one-time import source, not a mirror. An owner-approved migration job must:

1. Inventory each legacy trip, JSON file, document and media asset; classify it
   as canonical private content, proposed broad/public content, or excluded.
2. Copy each retained file into VPS object storage, verify its hash and create
   the appropriate canonical records. Import private content as owner-only.
3. Create new draft projections from only manually reviewed public-safe
   material; never infer a scope from the old route or directory name.
4. Preview and explicitly publish a public projection before generating a new
   static export at the preserved `/<trip-slug>/` URL where that slug is safe
   and available. Record redirects when preservation is not possible.
5. Retire the Git-backed deployed copy only after an audit confirms the new
   representation, assets, redirects and purge plan. Git history remains code
   history; it does not receive future edits or files from the application.

There is no scheduled import/export replication between the application and
Git. After a trip migrates, edits occur only through canonical application data
and explicit projection publication.

## Implementation gates

Before this design becomes tables or endpoints, the implementation must add
Alembic migrations, owner/public/unlisted response models, scope validation,
object-store integration, capability delivery, export/purge workers, and tests
for each state transition. Tests must prove that canonical fields and IDs do
not appear in projections, revision immutability survives later owner edits,
unpublish/revocation invalidate the right delivery paths, imports are copied to
VPS storage, and the legacy importer does not establish ongoing replication.
