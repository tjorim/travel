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
- Public and unlisted views are delivered from live scoped projections. Unlisted
  pages and their files stay behind a capability-checking application delivery
  layer, so revocation remains effective.

`v1` means the first application-backed model. Existing `dist/` files are
archive material, not an import source or schema authority for the fresh launch.

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
| `stay` (`travel/stay@1`) | `id`, `trip_id`, `check_in_date`, `check_out_date`, `status`, optional `exact_place_id` and `broad_place_id` | The nights slept at one accommodation (check-in date up to the check-out morning, local to the stay). Holds the optional property name, local check-in/out times, website, booking/contact references and notes; property and exact place stay empty until chosen. A shareable stay card is a separate `broad_stay_card`, never a selection of this row. |
| `broad_stay_card` (`travel/broad-stay-card@1`) | `id`, `trip_id`, `broad_place_id`, `title`, `date_precision` | Contains only owner-authored city/region text and approved date precision. It cannot reference a stay in a shared representation. |
| `route_stage` (`travel/route-stage@1`) | `id`, `trip_id`, `position`, `broad_place_id`, `arrives_on`, `departs_on` | Ordered unique `(trip_id, position)`; optional owner-only transport/note data. It always points to a broad, not exact, place so the chosen shared stage is explicit. |
| `moment` (`travel/moment@1`) | `id`, `trip_id`, `occurred_at`, `exact_place_id` nullable, `title`, `body` | Full owner journal/moment text and private links. It is not itself shareable. |
| `moment_excerpt` (`travel/moment-excerpt@1`) | `id`, `trip_id`, `source_moment_id` nullable, `broad_place_id` nullable, `date_precision`, `title`, `body` | A standalone approved excerpt. `source_moment_id` is owner-only provenance and optional so an excerpt can outlive a deleted journal item; it is absent from share output. |
| `stored_object` (`travel/stored-object@1`) | `id`, `trip_id`, `bucket`, `object_key`, `sha256`, `byte_size`, `content_type`, `encryption_key_ref`, `state` | Object storage inventory. Keys are application-only; `state` is `staged`, `available`, `quarantined`, or `purge_pending`. Deduplication never crosses owners. |
| `media_asset` (`travel/media@1`) | `id`, `trip_id`, `original_object_id`, `captured_at`, `exact_place_id` nullable, `media_kind`, `import_id` | Raw EXIF/XMP/IPTC, camera data, people/face tags, captions and provenance are owner-only. `original_object_id` always points to a VPS copy. |
| `media_derivative` (`travel/media-derivative@1`) | `id`, `trip_id`, `media_asset_id`, `object_id`, `purpose`, `metadata_stripped_at`, `review_state` | `purpose` is `owner_preview` or `share`. A shared derivative is usable only after metadata stripping and owner review; it has approved caption and alt text stored in its projection item, not raw metadata. |
| `document_asset` (`travel/document@1`) | `id`, `trip_id`, `original_object_id`, `document_kind`, `title` | Original filename, extracted text, OCR, booking data and metadata remain owner-only. |
| `document_derivative` (`travel/document-derivative@1`) | `id`, `trip_id`, `document_asset_id`, `object_id`, `redaction_manifest_object_id`, `review_state` | A possible shared file is a new, reviewed redacted derivative. No original object can be projected. |
| `import_record` (`travel/import@1`) | `id`, `trip_id`, `provider` (`direct_device`, `google_photos_picker`, `gopro_cloud`), `state`, `requested_at`, `completed_at`, `failure_code` | Owner authorization/consent time, provider item reference and transfer checksum are owner-only. Provider access tokens are held in a secret store, never in this table or a browser response. An import completes only once copied and verified in `stored_object`; provider URLs are not retained as file delivery URLs. |
| `public_surface` (`travel/public-surface@1`) | `trip_id` unique, `slug` unique, `scope_json`, `state` | The stable public URL reservation and its live, owner-selected scope. It has no capability; it is servable only while `state=published`. `scope_json` is validated as `travel/share-scope@1` and is a live field, editable whether or not the surface is currently published — every request renders it against current canonical data, so there is no separate frozen `publication_draft`/`projection_revision` pair to promote. |
| `share_link` (`travel/share-link@1`) | `id`, `trip_id`, `label`, `token_verifier`, `scope_json`, `expires_at`, `state`, `activated_at`, `revoked_at` | Owner-only `label`; verifier is a keyed one-way digest of a 256-bit capability. State is `draft`, `active`, `revoked`, or `expired`. `scope_json` is likewise live: while `draft` or `active`, the owner can widen or narrow it at any time, and an `active` link reflects the change immediately for its existing token. Only `state` — minting, revoking, or rotating the token — is gated. |
| `audit_event` (`travel/audit-event@1`, not yet implemented — [#48](https://github.com/tjorim/travel/issues/48)) | `id`, `trip_id`, `actor_subject`, `kind`, `target_type`, `target_id`, `occurred_at`, `details` | Owner-only audit without raw capability, recipient identity, or recipient IP. Publication/link activity follows the 24-month policy retention. |

Database constraints enforce that every resource id referenced by a
`scope_json` belongs to the same trip as the referencing `public_surface` or
`share_link` row. The service validates the scope on every write, not only at
activation; foreign keys alone cannot make a nested projection safe.

## Versioned representation contracts

These are the complete field sets permitted to leave the owner boundary. They
are schemas, not examples: any key not listed is rejected by the renderer on
every request. All strings are plain text after server-side sanitization; all
URLs are audience-specific delivery URLs or public export-relative URLs, never
object keys or provider URLs.

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

Both are complete, standalone display documents rendered live on every
request. They contain `schema_version`, `title`, optional `summary`, approved
date string(s), an ordered `route_stages` array, optional broad `places` and
`route`, `moments`, `stays`, `media`, and `documents`. Every display item has a
projection-local `id`, not a canonical ID. `media.image` and `documents.file`
are delivery references that identify only the approved derivative. The
unlisted form may contain a different set of approved items, but has the same
prohibited-field rules as public. It additionally carries no link label, raw
token, expiry, or internal link ID.

The server renders these contracts live from canonical records on every
request, filtered strictly to the resource ids and fields named in
`scope_json`; it never serializes a full trip and then redacts it. The
allowlisted schema — not a frozen content snapshot — is what keeps a newly
added canonical field from leaking through an ORM response: the renderer only
ever emits fields the schema names. An out-of-scope resource can accordingly
never appear even after being added to the trip later, while content for an
already-approved item (a wording fix, an updated label) is visible on the very
next request, with no republish step.

## Publication and sharing state machines

| Record | States and allowed direction |
|---|---|
| `public_surface.scope_json` / `share_link.scope_json` | Live at any time (link: while `draft` or `active`); there is no draft/preview_ready/frozen state for scope itself. |
| `public_surface.state` | `unpublished` -> `published` -> `unpublished`. There is no generation step or separate `publishing`/`unpublishing` transient state. |
| `share_link.state` | `draft` -> `active` -> `revoked` or `expired`; `revoked` and `expired` are terminal. |

### Public projection

1. The owner selects safe, separately authored resources and fields into
   `public_surface.scope_json`. This is a live field: it can be edited at any
   time, published or not, and a canonical edit to an already-selected item
   (a wording fix, a new photo) is reflected the next time the page renders —
   there is no separate draft/frozen-revision step to carry it forward.
2. The owner may `preview` at any time as a non-gating, owner-authenticated,
   `no-store` render check. It does not change any state.
3. `publish` sets `public_surface.state = published`. From that point, every
   request to the public delivery endpoint renders `scope_json` against
   current canonical data directly.
4. `unpublish` sets `public_surface.state = unpublished`. The stable URL
   immediately returns 404. It does not change canonical data or named share
   links.

The public view is a live API response (delivered for trips/route stages/moments
in [#42](https://github.com/tjorim/travel/issues/42)). The fresh-launch
route boundary is defined by [#101](101-legacy-route-transition.md).

### Unlisted capability

1. The owner prepares a `share_link` in `draft` with a scope, and may preview
   it at any time as a non-gating, owner-authenticated check.
2. `activate` is the one deliberate, one-time action that mints the
   high-entropy capability, stores only its verifier, and moves the link to
   `active` with a 30-day default expiry, a chosen expiry no later than 90
   days, or an explicit owner choice of no expiry.
3. A capability exchange verifies state and expiry, then renders the unlisted
   contract live against current canonical data filtered to the link's
   current `scope_json` — there is no frozen representation to load. It uses
   `Cache-Control: no-store, private`, `X-Robots-Tag: noindex, noarchive`, and
   `Referrer-Policy: no-referrer`.
4. While `active`, the owner can edit `scope_json` directly, widening or
   narrowing it; the change is visible to the existing token on its very next
   exchange, with no separate reactivation step. `revoke` or expiry reject
   exchanges immediately and invalidate any application-controlled caches for
   that link (delivery is `no-store` in the first place, so there is little
   to purge). `rotate` revokes the old capability and mints a fresh one for
   the same current scope — for replacing a suspected-leaked token, not for
   changing scope, which does not require rotating.

An unlisted view is never exported as a static origin path; it is served only
through the capability-checked live delivery endpoint, so revocation remains
effective.

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

Deleting a canonical resource removes it immediately from owner queries. A
public surface or share link whose scope referenced it simply omits that item
on its next render rather than being withdrawn, since scope is a live filter
over current data, not a frozen reference — the surface or link itself stays
active for its remaining items. The purge job removes the deleted resource's
own derivative objects, static paths, signed-url grants and caches. The
policy's 30-day sealed recovery and 90-day backup limits still apply. A
restore replays current deletion, publication, and revocation state before
serving restored data.

## Fresh launch data

The owner creates or enters application trip content directly. No `dist/`
JSON, documents, media, manifests or URL slugs are imported, mapped or
published automatically. The application starts with its own canonical records,
private files and explicitly chosen share scopes. Git-backed archive content
is withdrawn from serving at launch while its files remain in the repository;
it is not a source for live views or a compatibility route. See
[#101](101-legacy-route-transition.md).
Any later work on old `dist/` content belongs to
[#40](https://github.com/tjorim/travel/issues/40) and does not gate launch.

## Implementation gates

Publication/share-link delivery for trips, route stages, and moments was
implemented in [#42](https://github.com/tjorim/travel/issues/42): Alembic
migrations, owner/public/unlisted response models, scope validation, and
capability delivery, with tests for each state transition. Because v1 renders
scope and content live rather than freezing a revision, its tests instead
prove that an out-of-scope resource never appears even after being added to
the trip later, that a scope or content edit to an already-shared item is
reflected on the very next request, and that unpublish, revocation, expiry,
and rotation each invalidate the right delivery path immediately. Stays,
media, documents, and tracks — and their object-store integration and
export/purge workers — remain to be modeled and wired into the same
`scope_json` mechanism by the issues that introduce them (`#43`, `#38`,
`#34`). An owner-only audit trail
([#48](https://github.com/tjorim/travel/issues/48)) remains a separate concern.
There is no legacy importer in the launch plan; #40 is separate follow-up work.
