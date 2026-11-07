# Sharing Presets With Per-Record Exceptions

Design note, 2026-11-07, issue #241. **Status: proposed, for the owner's review.**
Nothing here is implemented. The owner decided on 2026-11-06 for presets with
per-record exceptions and today's fine-grained controls under an Advanced view
(option a of #241); this note designs the presets and does not reopen that.
The Advanced view and the single date control shipped first (see the end of this
note) so that the presets have a quiet place to land.

Builds on, and must not undo: [#36](36-privacy-sharing-offline-policy.md) and
[#37](37-canonical-content-and-publication-model.md) (allowlists, `everyone`),
[#15](15-sharing-scope-revisions.md) (revisions), [#27](27-merge-widening.md)
(widening acknowledgement), #236 (date precision per audience) and #237 (per-link
exclusions), both described in [the domain model](../domain-model.md).

## The problem in one paragraph

A 22-night trip carries 143 records, each with its own visibility, and 69 visits
and stays with their own date precision. The protections are sound; the number of
decisions is what makes owners skip the review. A preset replaces many decisions
by one named starting point, and the existing per-record controls stay as the
exceptions. The Sharing check and the rendered preview stay the confirmation.

## 1. What a preset is

### Hard constraint

Visibility `everyone` keeps meaning *delivered to the public view and every hidden
link and collection member* (decision 36, "Amended 2026-09-25"). A preset must not
become a second, persistent source of truth for who receives a record, and must
not make `everyone` mean less than everyone for the public view.

### Options considered

| | Option | Verdict |
|---|---|---|
| A | **A persistent allowlist of kinds per audience** ("this link receives updates, areas and routes, whatever else is added"). | Rejected. It is exactly what the constraint forbids: a record set to `everyone` would stop meaning everyone for that audience, a second delivery path would sit beside `visibility` + `items` + `exclude`, and every projection, file, navigation and collection path would have to learn it. It would also make future records join an audience silently. |
| B | **A trip-wide visibility template**: "make updates, areas and routes `everyone`, everything else `private`". | Honest and simple, but it is the bulk action of option (b): it moves every audience at once, so one click can widen the public view and every link together, and it cannot give two links different presets. Keep it as a possible later bulk action, not as the preset. |
| C | **An audience-scoped template**: choosing a preset computes a concrete change set for one audience from the records as they are now, shows it, and writes it through the mechanisms that already exist (`custom` visibility plus the audience's `items`, the audience's `exclude`, and `defaults.date_precision`). It remembers which preset was last applied as a display label, never as a rule. | **Recommended.** |
| D | A preset that only previews (no apply). | Cuts no decisions. |

### Recommendation: C, a template

Applying a preset to one audience (the public view, one hidden link, or one
collection member) works out, from the trip's records:

1. the **target set**: the records the preset's kinds and filters select that are
   shareable right now (`access.sharing_blocker` is `None`), minus the exceptions
   the owner then chooses;
2. the **change set** that makes the audience receive exactly that target, using
   only these writes:
   - a record that is `private` becomes `custom` and is listed in this audience's
     `items` (the same two steps as ticking it in Advanced today); a `custom`
     record not yet listed is listed; **a preset never writes `everyone`**, so no
     other audience gains anything;
   - a `custom` record this audience lists but the target does not contain is
     unlisted (it stays `custom`);
   - on a hidden link or collection member, an `everyone` record the target does
     not contain is added to `exclude` (the public view cannot do this, see below);
   - the audience's `defaults.date_precision` becomes the coarser of its current
     value and `month`: a preset never makes dates finer;
3. a **review** of the change set, shown and confirmed like the existing widening
   flows (section 4), then one write.

What it remembers: a display label only, `applied_preset` (the preset's id) and
`applied_preset_at`, on the audience. Delivery, projection, files, navigation, the
collection index and `access.receivers` never read it. It exists so that the editor
can say "Story and route, with 3 exceptions" and compute those exceptions (the
difference between what the audience receives and what the preset would select
today). Creating a record, or changing one, never consults it, so a new record is
`private` as always and never joins an audience because a preset was applied.

Why a column and not the scope JSON or the audit trail: the scope is *what* an
audience receives, and `PUT` rewrites it from clients that may not know a new key;
the audit trail is retained 24 months and is not meant to be read by the editor.
A nullable column is ignored by older code, so a rollback loses the label and
nothing else. (Cheaper alternative with no migration: derive the label from the
latest audit event. Rejected because it makes owner-visible state depend on audit
retention; listed as open question 5.)

Trade-offs of C:

- It is a *template*, not a filter. After applying "Story only", a new record set
  to `everyone` still reaches that link, because `everyone` means everyone. The
  review and the Sharing check say so, and so does the safety check.
- A link's `exclude` lists records, not kinds, so a "Story only" link over a large
  `everyone` baseline stores one entry per record. The scope allows 200 `items` and
  500 `exclude`; a plan that would exceed either is refused with a reason
  (`preset_too_large`) rather than truncated, and the caps can be raised separately.
- It needs a planner that can compute the after-state without writing (a nested
  transaction rolled back for the preview, so `projection.delivered` is the one
  function that says what the audience would get).

## 2. The first preset set

Presets are code constants (`travel/sharing-preset@1`), not user data, and each
later preset extends the one before it. Every preset applies to *shareable*
records only (the blocker check at delivery still runs), and only to the kinds in
the table; any kind not listed in a column is **left exactly as it is** for that
preset's own choices but is still part of the review when it is currently
delivered.

| Kind | Story only | Story and route | Planned trip |
|---|---|---|---|
| Reisupdates | all with text for visitors: title, text, date, area | same | same |
| Photos and videos | approved copies **attached to the included updates** (they travel with them) | same | same |
| Areas | none, so updates carry no map point (the Sharing check already counts these as *without a map point*) | all named areas: label, region, country, rounded point | same |
| Routes | none | planned or booked routes (never ideas): mode, status, the two areas, schedule, carrier and service reference, drawn line | same |
| Visits | none | none | planned and confirmed visits (never ideas or cancelled): title, text for visitors, area, days at the audience's precision |
| Stays | none | none | planned and booked stays (never ideas): area and nights at the audience's precision |
| Locations | never | never | never |
| Loose gallery photos | never (their own visibility decides) | never | never |
| Date precision (`defaults.date_precision`) | `month` | `month` | `month`; the owner can raise it afterwards with the audience's date control |
| Trip title, summary, trip dates, cover | untouched | untouched | untouched |

What stays private under every preset: everything not in its column, and always
the fields below.

### What no preset can include

A preset only selects records and sets the audience's date cap, so it cannot add a
field to any kind's allowlist. In addition, by design, a preset never selects or
changes:

- a **location** at all, and so never an address, postal code, notes, provider ids
  or display name; `share_address` is never set or read by a preset;
- **times**: `share_time` is never set by a preset. A visit that already has
  `share_time` on is not swept in by a preset; it is listed in the review under
  *needs your decision*, so "never times" holds for everything the preset adds;
- a stay's **property, location, check-in details, contacts, booking and notes**;
- a route's **booking reference, travel class, notes, documents** and exact
  locations (which reach a map only when that location is itself shared);
- a reisupdate's **private notes, exact location, attached originals and exact
  time**; a photo's **original and metadata**; any **document**;
- an area's **time zone**;
- the **trip title, summary, trip dates and cover** choice, and any link's label,
  token, expiry or state;
- the value `everyone` on any record.

## 3. Per-record exceptions, in both directions

Exceptions are not stored. They are the live difference between what the audience
receives and what its last-applied preset would select now, computed on the server
(`presets.review`) and shown as two short lists.

| Wanted | How, with today's mechanisms |
|---|---|
| **Show** a record the preset does not include (a stay under "Story and route") | Make it `custom` and list it for this audience: the *Records for this audience only* lists under Advanced, or the record's own visibility control plus the list. |
| **Hide** a record the preset includes (one update) | If the audience lists it through `items`: unlist it. On a hidden link or collection member, if it reaches the audience through `everyone`: add it to `exclude` (the link's *Leaves out* list), which also hides what depends on it (#237). |
| **Hide an `everyone` record from the public view** | Not possible per audience: the public view is the baseline and has no `exclude`. Change the record's own visibility (`custom` or `private`), which also changes every other audience; the existing control already says so. |

Because a preset realises its target with `custom` plus `items`, hiding an update
on the *public view* works as a plain unlisting when the preset added it, and the
exceptions list names the record with the right action for how it reaches the
audience. A record that reaches the public view only because it is `everyone` is
reported as *left as is* and never changed by a preset.

## 4. Applying a preset

### Preview and confirmation

`preview` (no writes) and `apply` are the same plan. The review, owner-only, lists
records by name, and carries counts per kind for:

- **widened**: records the audience newly receives (private to custom-and-listed,
  custom listed, exclusions removed); **narrowed**: records it stops receiving
  (unlisted, newly excluded, including what an exclusion also hides);
- **precision**: the audience's cap before and after, and how many visits, stays
  and updates would read coarser (a preset never makes dates finer, so there is no
  precision widening);
- **left as is**: `everyone` records the preset would not select, which a public
  view keeps receiving (and a link receives unless the plan excludes them);
- **needs your decision**: records a preset deliberately does not sweep in
  (`share_time` on, a blocker such as an update without text, with the reason's
  code);
- **replaces your exceptions**: records the owner hid by hand (an `exclude` entry,
  an unlisted record the preset selects) that this apply would show again.

Confirmation follows decisions 27, #236 and #237:

- Applying to a **draft** link or draft collection delivers nothing yet, so no
  acknowledgement; the review is still shown.
- Applying to a **live** audience (published public view, active link, active
  collection member) always shows the review and needs an explicit *Apply*.
  Anything it widens needs the acknowledgement as well: the request is refused with
  `409 preset_widening_needs_acknowledgement` (detail: counts per kind and the
  records) until `confirm_widening` is sent; nothing is stored and the revision is
  not claimed. Narrowing needs no acknowledgement but is counted and named.
- Because the records can change between the preview and the apply, the apply
  carries the preview's `fingerprint` (a digest of the plan). If the plan is now
  different the request is refused with `409 preset_preview_is_stale` and a fresh
  review, like `merge_private_choice_is_stale`.

### Revisions

Applying is a scope write, so it follows decision 15: it takes the audience's
revision in `If-Match`, claims it atomically with the writes, and answers
`412 scope_revision_conflict` with the current owner response when it is stale. A
missing `If-Match` stays an unconditional write for MCP and API compatibility and
still advances the revision, so older editor drafts conflict afterwards. The
widening refusal is decided before the revision is claimed, as for exclusions.

### Audit

One event per apply, never one per record:
a new kind, `audience.preset_apply` (the existing scope-change kinds keep their
meaning, and a preset does not also write them), whose details hold the preset id,
the audience id, the counts per kind of widened, narrowed, left-as-is,
needs-decision and replaced exceptions, the precision before and after, and the
scope fingerprints before and after. Record ids are not needed to reconstruct it and
no label or owner text is written. The per-record `record.visibility_change` events
that the same private-to-`custom` change would write one by one are **not** written
for a preset's promotions (they reach nobody until listed); the aggregate event
covers them. For a collection member the same details go to a
`collection.member_preset_apply` collection event (collection events use free-text kinds,
like `collection.member_scope_change`). The 24-month retention applies.

### Records the owner already set by hand

- `everyone` records: never changed by a preset (see above).
- `custom` records: listed or unlisted as the target says; their visibility stays
  `custom`.
- `private` records in the target: promoted to `custom` and listed for this
  audience only.
- A visit's or stay's own `share_date_precision`: never changed; the coarser value
  still wins, so a record held to `month` stays `month`.
- A link's existing `exclude` entries: kept only if the record is outside the
  target; an entry for a record the target contains is removed and reported under
  *replaces your exceptions* (removing it is a widening and is acknowledged as such).

### Idempotence

Applying the same preset to the same unchanged audience produces an empty plan:
`applied: false`, no writes, no new revision, no audit event. Re-applying after the
owner made exceptions *resets them* (they are listed in the review first); open
question 2 asks whether a re-apply should keep them.

## 5. Public view, hidden links and collection members

One planner serves all three, because a collection member has the same scope shape
and validation as a link (decision 36).

- **Hidden link**: the full set of writes. Its `exclude` realises "narrower than the
  public view". A new link may start from a preset (question 4).
- **Collection member**: the same plan against the member's scope, with the same
  review, acknowledgement and `collection.member_scope_change` revision rules. A
  preset does not touch the collection's title, members or lifecycle, and `everyone`
  records still reach every member (decision 36); the owner overview already flags a
  member that delivers nothing beyond the title.
- **Public view**: `custom`/`items`, precision and review only. It cannot `exclude`,
  so a preset that is narrower than the current `everyone` records cannot hide them;
  the review lists them as *left as is* with the way out (change their own
  visibility). The public view therefore never receives less-than-`everyone` as a
  side effect, and `everyone` keeps its meaning.

Out of scope: applying one preset to every audience at once; presets that make
records `everyone`; any rule that makes future records join an audience; user-defined
presets; per-field choices; locations, addresses and times; changing an allowlist or
what a field can reveal; the cover choice; changing a trip's title, summary or trip
dates; presets across trips; the static export.

## 6. API and MCP

All surfaces call one function, `app/presets.py`, from the route functions, the way
`follow_audience_precision` and `choose_visibility` are already shared with MCP.
There is no new path to a visitor: the planner only reads `projection.delivered`,
`access.sharing_blocker` and `exclusions`, and writes `Visibility`, the audience's
scope and the new label columns.

| Surface | Contract |
|---|---|
| `GET /trips/{id}/sharing-presets` | The preset definitions (id, kinds, filters, precision), so clients show the same set. |
| `POST /trips/{id}/public-projection/preset` | `{preset, confirm, confirm_widening, fingerprint}`, `If-Match`. Without `confirm`: the review only. |
| `POST /trips/{id}/share-links/{link_id}/preset` | Same, for a draft or active link. |
| `POST /collections/{collection_id}/members/{member_id}/preset` | Same, for a member. |
| MCP `preview_sharing_preset`, `apply_sharing_preset` (or one tool with `confirm`, like `follow_audience_date_precision`) | Same arguments and errors, `requires_confirmation` for the apply, registered behind the layered discovery of decision 196 with a description that tells the agent to show the review and pass `confirm_widening` only after the owner accepts. |
| Owner overview | Each audience gains `preset`, `preset_exceptions` (counts) so the Sharing check can say "Story and route, 3 exceptions". |

### Migration

One Alembic revision (after 019): nullable `applied_preset` (short string) and
`applied_preset_at` on `public_surfaces`, `share_links` and `collection_members`,
and the new audit kind `audience.preset_apply` with
`ALTER TYPE public.travel_audit_event_kind ADD VALUE IF NOT EXISTS …` as in 019.
Existing rows get `NULL`, so every existing scope and record delivers exactly what it
did before. The downgrade drops the columns; an older application ignores them and
never reads the label. No data migration.

## 7. Tests required

Backend (projection first):

- **Never more than preset + exceptions**: property tests over generated trips with
  every combination of visibility, status, blocker, `share_time`, `share_address`
  and own precision: after any apply, `delivered(trip, scope)` for that audience is
  a subset of (the preset's allowed kinds that pass their blockers) ∪ (records that
  were `everyone` before) ∪ (the owner's explicit `items`), and contains no
  location, document, loose photo, idea, cancelled visit or record with a blocker.
- **No other audience changes**: every other audience's `delivered` set and every
  record's `visibility` that is `everyone` or `private` stay identical (a preset
  writes no `everyone`).
- **Projection allowlists unchanged**: the existing document and file tests pass
  untouched; a preset adds no field.
- **Legacy audiences unchanged**: golden fixtures of scopes without the label
  (including `defaults` absent and `exclude` present) deliver byte-identical
  documents before and after the migration; the label columns default to `NULL`.
- Idempotence, plan equals apply (the preview's counts are what the apply does),
  `preset_preview_is_stale`, `preset_widening_needs_acknowledgement` leaves the
  revision untouched, stale `If-Match` is 412 with the current record, draft needs
  no acknowledgement, collection member parity, the public view refusing to
  exclude, `preset_too_large`.
- **Audit**: the event holds ids of the preset and audience and counts only; no
  label or owner text.
- **MCP**: the tool calls the same function, requires `confirm`, and returns the
  same review JSON in the error.

Frontend: component tests for the picker, review and exceptions; Playwright and axe
for the review dialog in both locales and themes at laptop and phone width,
keyboard and screen reader; dirty-editor and focus return like the existing widening
dialog.

## 8. Implementation plan

At most four steps, each one PR:

1. **Planner and read-only review.** `app/presets.py` with the three definitions, the
   plan, review and fingerprint, `GET …/sharing-presets`, the `preview` form of the
   three endpoints and the MCP preview, with the projection property tests. No
   writes, no migration.
2. **Apply.** The migration, the writes with revisions, widening, staleness and the
   audit kind, the MCP apply, the overview fields, and the remaining backend tests.
3. **Owner interface.** Preset picker and review dialog in the audience editor for
   the public view, hidden links and collection members; the exceptions lists; the
   Sharing check line; both locales; unit and Playwright tests; screenshots.
4. **Documents and the shorter check.** `docs/domain-model.md`, decision 36 and
   `docs/publication-safety-check.md` (a check that starts from the preset and the
   exceptions list instead of one line per record), changelog, and the final
   regression of the owner and visitor views.

## 9. Open questions for the owner

1. **Do records created later join a preset?**
   (a) No: a preset is applied once and new records are `private` (recommended;
   keeps "sharing an item never makes later items shared").
   (b) Opt in per audience: "also add new updates" as an explicit setting.
2. **Re-applying a preset after exceptions were made.**
   (a) Reset to the preset, listing the exceptions first (recommended; predictable
   and idempotent).
   (b) Keep exceptions by default, with a checkbox to reset.
3. **Photos.**
   (a) Only approved photos attached to included updates (recommended; loose
   gallery photos keep their own visibility).
   (b) Also every approved loose photo under "Story only".
4. **A new hidden link.**
   (a) Start as today (the public baseline) with an optional preset picker whose
   first choice is "Same as the public page" (recommended).
   (b) Make choosing a preset part of creating a link.
5. **Where the last-applied label is kept.**
   (a) Nullable columns, migration 020 (recommended).
   (b) Derived from the latest audit event, no migration.
6. **The public view and `everyone` records outside the preset.**
   (a) Leave them and list them with the way out (recommended).
   (b) Offer a one-click "make these Custom", which also narrows hidden links that
   relied on them.

## Shipped with this note: the Advanced view (Part A)

The audience editor (public view, hidden links, collection members) now keeps its
primary controls short: trip title, summary, **Dates shown to this audience**
(the #236 cap, with *No limit: each record decides* only where it exists), and for
links the *Leaves out* list. A collapsed **Advanced** disclosure holds the older
**How precise can the travel dates be?** (`scope.trip.dates`, which also decides
whether trip dates are shown at all) and the *Records for this audience only*
(`custom`) lists. It starts open when anything inside differs from the default
(trip dates shown, or an audience that already lists records), and never closes by
itself. The visit and stay editors keep *Dates for visitors* and *Show the time*,
and the location editor *Also share the address*, under the same disclosure, open
when the record already uses them.

The two date controls were kept as two, because they are not the same setting: the
audience cap limits **every** date an audience reads, while `trip.dates` also decides
whether the trip's own dates are shown at all and may be absent. Folding them into
one control plus a "Show the trip's start and end dates" box would have to invent a
value for stored scopes where the two disagree (for example `trip.dates: year` with a
cap of `month`), or rewrite `trip.dates` when the cap changes, which could silently
widen what a live audience reads. Keeping both, with the older one under Advanced
and a line saying that the cap applies to it too, leaves every stored scope
delivering exactly what it did, writes nothing on open or on save unless the owner
edits that control, and the Sharing check's date lines still state the effective
result without opening Advanced. Presets would later make this a non-issue for most
owners: they set the cap, and leave `trip.dates` where it is.
