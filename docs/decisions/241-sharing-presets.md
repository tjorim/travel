# Sharing Presets With Per-Record Exceptions

Design note, 2026-11-07, issue #241. **Status: implemented** (all four steps: planner and
read-only review; apply, migration 022 and audit; the owner interface; documents, the shorter
check and the final regression). See
[Step 1 implemented](#step-1-implemented-planner-and-read-only-review),
[Step 2 implemented](#step-2-implemented-apply-migration-and-audit),
[Step 3 implemented](#step-3-implemented-the-owner-interface) and
[Step 4 implemented](#step-4-implemented-documents-the-shorter-check-and-the-final-regression)
at the end, and [the acceptance list](#acceptance-of-241-and-where-it-is-satisfied). The owner decided on 2026-11-06 for presets with
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
| Areas | none, so updates carry no map point (the Sharing check already counts these as *without a map point*) | named areas that an included update or route uses (never an area no included record names): label, region, country, rounded point | same |
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


## Step 1 implemented: planner and read-only review

Shipped (Part of #241). Nothing is applied: no migration, no scope or visibility write, no revision, no audit event.

- `app/sharing_presets.py`: the three presets as code constants (`travel/sharing-preset@1`, ids `story_only`,
  `story_and_route`, `planned_trip`, each extending the one before), `plan_preset(trip, audience, preset_id)` (pure) and
  `review_preset(session, trip, audience, preset_id)`.
- Review endpoints (owner-only, `POST`, body `{"preset": …}`): `…/public-projection/preset/review`,
  `…/share-links/{link_id}/preset/review`, `/collections/{collection_id}/members/{member_id}/preset/review`; and
  `GET …/sharing-presets` for the definitions. MCP: `list_sharing_presets`, `preview_sharing_preset(trip_id, preset,
  audience)` with `audience` `public`, `link:<id>` or `collection:<member id>`, both read tools. They share one handler
  (`routers/sharing_presets.py`). The apply of step 2 goes to `…/preset` with the review's `fingerprint`; the review has
  its own path so that a read-only call can never write, instead of one endpoint that previews without `confirm`.
- The "after" is rendered by `projection.delivered` from the planned scope with the planned `private → custom`
  promotions made inside `session.begin_nested()`, which is always rolled back (and the touched records expired), so
  `delivered` stays the one source of truth. While the plan is in place the review also renders every *other* audience
  of the trip (drafts too) and fails with `preset_changed_another_audience` if any of them would receive something
  different: "never changes another audience" is enforced, not only tested.
- What the plan decides, concretely. *Managed kinds* (area, visit, stay, route, reisupdate) get an exact target, so a
  record outside it is unlisted (custom) or, on a link or member, left out (`everyone`). Selection is by kind and status
  (planned or confirmed for visits, stays and routes; a record the sharing gate refuses is never selected). *Unmanaged
  kinds* (locations, loose photos) are never listed, unlisted or excluded: their own visibility decides, and the review
  lists them under `left_as_is` with the way out. A photo is in the target only when it is an approved share copy
  attached to an included update; it travels with the update through `delivered`, so a preset writes nothing for it.
- An exclusion is made only when it hides no record the preset includes (`exclusions.closure`): an `everyone` area that
  an included update names stays and is reported as `needed_by_included_records`. An exclusion the owner made by hand
  is kept only while it hides nothing the preset includes, otherwise it is removed and listed under
  `replaces_exceptions`, as is a `custom` target record that was not listed for this audience (`left_out_by_you`).
  A cascade-hidden record gets no separate exclusion entry of its own, to keep the 500 cap for real choices.
- `defaults.date_precision` becomes the coarser of the current value and `month`; a preset never makes dates finer. The
  review counts the visits, stays and updates that would read coarser.
- Refusal: a plan beyond 200 listed records or 500 exclusions is not applicable (`refusal.code` `preset_too_large`, with
  counts and limits, `comparison` null); the review is a 200 because nothing failed, step 2 will answer the same plan
  with an error. The limits are the constants `MAX_SCOPE_ITEMS` and `MAX_SCOPE_EXCLUSIONS` in `schemas.py`, shared with
  the scope input.
- Not swept in, with the code to show the owner: a record the preset's kind selects that the sharing gate refuses (the
  blocker's code, for example an update without text or an unnamed area), a visit that already shows its times
  (`share_time_is_on`) and an unapproved share copy attached to an included update.
- A review of a public view that was never saved does not create it: it reads the default scope (dates by month) that a
  new public view would hold.
- Tests: `tests/test_sharing_presets.py` (each preset's target, never `everyone`, no other audience changes, precision,
  `exclude` on a link versus the public view, caps, nothing written, owner-only, collection members, idempotence of the
  plan, and a randomised property test that a preset adds only what it selects) and one MCP test.

### The six answers, as built

1. **New records do not join a preset.** The plan is computed from the records at review time and nothing is
   remembered; a new record is `private`.
2. **Re-applying resets exceptions**, and the review lists them first (`replaces_exceptions`).
3. **Photos:** only approved share copies attached to included updates. Loose photos are unmanaged and keep their own
   visibility.
4. **A new hidden link** is untouched in this step; the optional picker whose first choice is "Same as the public
   page" belongs to the interface step.
5. **The last-applied label** (nullable columns; migration 022, the number 020 of the first plan having gone to an earlier change) is part of step 2; step 1 has no label and no migration.
6. **The public view and `everyone` records outside the preset** are left as they are and listed with the way out
   (`left_as_is`, `everyone_on_public_view`, `change_visibility`).

### Left for the next steps

Applying (writes, `If-Match` revisions, `409 preset_widening_needs_acknowledgement`, `preset_preview_is_stale`,
`audience.preset_apply` audit, the label columns), the owner interface, decision 36 and the shorter
`publication-safety-check.md`.

**Review amendment, 2026-11-07:** areas are selected only when an included update, route, visit or stay names them, so a private place the owner keeps for themselves (a home town) is never swept in by the table's "all named areas"; an unused area adds nothing to a visitor's map.


## Step 2 implemented: apply, migration and audit

Shipped (Part of #241). The backend applies a reviewed preset; the owner interface and the shorter safety check are steps 3 and 4.

- **Routes.** `POST /trips/{id}/public-projection/preset`, `POST /trips/{id}/share-links/{link_id}/preset` and
  `POST /collections/{collection_id}/members/{member_id}/preset`, body `{preset, fingerprint, confirm_widening}` with
  `If-Match`; the response is `{applied, review, audience}` with the audience as the owner sees it (new revision,
  label, exceptions). They sit next to the review paths and share one handler with the MCP tool
  `apply_sharing_preset(trip_id, preset, fingerprint, audience, confirm, confirm_widening)` (a write tool that
  requires `confirm`, like `follow_audience_date_precision`). There is no `confirm` field on the REST body: the
  endpoint is the apply, the review has its own path.
- **One function, `sharing_presets.apply_preset`**, serves the three routes and the two creation paths. It first claims
  the audience's revision (`If-Match`, or unconditionally when absent, 412 `scope_revision_conflict` with the
  current record), which also locks the row while the plan is read; every refusal then rolls the transaction back, so
  "the revision is not claimed" holds without ordering tricks. In order it refuses: a fingerprint that no longer
  matches (409 `preset_preview_is_stale` with the fresh review), a plan beyond 200 listed records or 500
  exclusions (409 `preset_too_large`, the same counts as the review's `refusal`), and a live audience that would newly
  receive records without `confirm_widening` (409 `preset_widening_needs_acknowledgement`: audience, counts per kind,
  the widened records). Then it writes: `set_visibility(…, custom)` for each promoted record (the same function a
  manual choice uses, so the sharing gate still applies, but no per-record `record.visibility_change` events are
  written), then `prepare_scope` on the planned scope with the audience's own rules (so a stale or invalid scope is a
  422 and rolls the promotions back), then the scope, the label and the audit event. No other path writes a record.
- **Never `everyone`, never another audience.** Before writing, every change is checked (`promote` only a private
  record, `list`/`unlist` only a custom one, and the planned `items` list no `everyone` record); after the
  promotions the session is checked for any pending write of `everyone`; after the scope write every other audience of
  the trip (drafts too) is rendered again and must be byte-for-byte what it was. Any violation rolls back and
  fails. The tests inject a faulty plan and a faulty write to prove each guard.
- **Draft versus live.** The acknowledgement follows the review's `requires_acknowledgement` (a live audience that would
  newly receive records; narrowing never needs one). A draft link, a draft collection and an unpublished public view
  deliver nothing yet. A **new** link or collection member created with a `preset` has received nothing, so it takes
  no fingerprint, claims no revision and needs no acknowledgement even in an active collection: its first delivered
  state is the preset's.
- **Idempotence, as designed.** The same preset on an audience that already matches the plan and already carries
  that label writes nothing (`applied: false`, the claimed revision is given back, no audit event). If the plan is
  empty but the audience carries no label or another one (the owner built the same selection by hand), the label is
  written, which is a write: it advances the revision and is audited.
- **Migration 022** adds nullable `applied_preset` (string, 32) and `applied_preset_at` to `public_surfaces`,
  `share_links` and `collection_members`, and the audit kind `audience.preset_apply`. Every existing row starts `NULL`
  and keeps its scope; the downgrade drops the columns and deletes the audit rows that use the new kind (PostgreSQL
  cannot drop an enum value; the unused value stays) and the `collection.member_preset_apply` collection events. Run
  against PostgreSQL: up, down one revision, down to base, up again, and `alembic check` shows no drift;
  `tests/test_sharing_preset_label_migration_postgres.py` covers it. No preset id is constrained in the database, so
  a later preset needs no migration and a label from a newer application is shown without exceptions.
- **The label is display only.** Projection, delivery, files, navigation, the collection index and `access.receivers` do
  not read it (a test flips it, clears it and sets an unknown id and the audience receives the same). Owner
  responses add `applied_preset`, `applied_preset_at` and `preset_exceptions` to the public view status, the link
  (also its MCP form, which still has no token), the collection member, the Sharing check's audience entries
  (`preset`, `preset_exceptions` as a count) and the owner export; a test asserts no visitor response (public page,
  public list, link, collection index, member page) mentions it. Rotating a link carries the label with the scope.
- **Exceptions.** `preset_exceptions` is computed on every owner read (`preset_exceptions(trip, scope, preset_id)`), never stored: for
  areas, visits, stays, routes and updates, `shown` = delivered records the preset would not select and `hidden` =
  records the preset would select that are not delivered (including a record created later, as answer 1 implies).
  Manual edits keep the label and change this list; re-applying resets it. Locations and loose photos are never
  exceptions.
- **Audit.** One `audience.preset_apply` event (target the public view or the link) or, for a member, one
  `collection.member_preset_apply` collection event, with the preset and audience ids, `on_creation`, `live`,
  `widening_acknowledged`, the counts per action and per kind of widened, narrowed, left-as-is, needs-decision and
  replaced records, the precision before and after and the scope fingerprints. No title, label, note or caption is
  written (a test searches the details for the owner text of the world). A draft apply is audited too: the aggregate
  event is cheap and the owner may later ask why a draft looks as it does.
- **Not done here** (tracked in the later steps of #241): the preset picker, the review dialog and the exceptions
  lists in the interface, the first choice "Same as the public page" on a new link, decision 36 and the shorter
  `publication-safety-check.md`. The `preset_changed_another_audience` guard reaches the client as an unhandled
  service error, as the review's does.


## Step 3 implemented: the owner interface

Shipped (Part of #241). Frontend only; the shorter safety check is step 4. No backend change was needed.

- **Where.** `PresetSection` sits at the top of the audience editor (`ScopeEditor`), so the public page, every hidden link
  and every collection member get it from one place; the editors' own controls (title, summary, *Dates shown to this
  audience*, *Left out of this audience*, Advanced) stay below it unchanged. It is not rendered in the read-only copy of
  the server's scope shown during a revision conflict.
- **Picker.** The three presets as a `ChoiceGroup` with the selected preset's description under it, and **Review preset**.
  Nothing is chosen at first, so the button is disabled until a choice is made. After an apply the choice is kept and the
  button stays enabled (focus returns to it; a disabled control cannot take focus); another audience starts with
  nothing chosen. The review reads the stored audience, so while the editor has unsaved edits the button is disabled and
  says to save or discard first. This avoids a second source of truth: the apply rewrites the audience on the server and
  the editor then loads the audience the server answers with.
- **A new hidden link (answer 4).** The first choice is *Same as the public page*; choosing a preset sends `preset` with
  the creation request (also for the draft a first preview creates). There is no review for a link that does not exist:
  it has received nothing, and the help text says the preview and the Sharing check show the result before activation. A
  new collection member is created empty and its scope editor opens at once, so it takes the picker with a normal review
  (no create-time preset in the UI; the API still allows one).
- **Review dialog.** `PresetReviewDialog` (a `DeleteConfirmation`, Base UI Alert Dialog) shows, from the server's review
  and nothing recomputed in the client: whether the audience is live; the records it starts and stops receiving (counts per
  kind in the heading, every record by name grouped by kind, folded when more than six); the date precision before and
  after and the records that read coarser; the owner's choices that the preset resets (`replaces_exceptions`, with why);
  what is left as it is, grouped by reason and way out with a sentence each; what needs a decision (the blocker's code
  through the existing error messages, `share_time_is_on` in words); and, for a live audience that would see more, the
  warning and the acknowledgement checkbox that enables *Apply*. A plan that would change nothing says so. The apply sends
  the review's `fingerprint`, `confirm_widening` only when acknowledged, and the audience's current revision in
  `If-Match` (read when the owner clicks, from the same ref the editor's Save uses).
- **Errors.** `preset_preview_is_stale` replaces the review with the fresh one in the dialog, says so and resets the
  acknowledgement; `preset_too_large` (at review or at apply) shows the counts and limits and leaves *Apply* disabled;
  `preset_widening_needs_acknowledgement` (if the client's idea of "live" was out of date) turns the acknowledgement on; a
  `412 scope_revision_conflict` offers *Reload the audience* with the current record the server sent, which the editor
  then loads; anything else shows the operation's fallback message, with the dialog kept open. Escape and Cancel are
  ignored while the apply is pending.
- **Label and exceptions.** An audience that carries a preset shows "Story and route, with 2 exceptions" (or "no
  exceptions") and when it was last applied, and `PresetExceptionsList` shows `preset_exceptions` in two lists (received but
  not in the preset; in the preset but not received). Each record has the action that already exists, applied to the
  editor's scope and saved with the editor's Save: **Show** unticks the link's exclusion, or lists the record for this audience
  (promoting a private one to Custom first, exactly as the Advanced lists do), **Hide** unlists a listed record or leaves an
  Everyone record out of a hidden link; an Everyone record on the public page has no per-audience way out, so the row
  says to change its own visibility. A row the owner just changed says "Change not saved yet" until the scope is saved and
  the server counts again. A short intro states that a record added later never joins a preset (answer 1); a record added since
  shows up as an exception until it is chosen or left out. Records with no catalog entry (not shareable now) show their name
  without an action.
- **Sharing check and link list.** Each audience's entry gains a "Preset: …" line from `preset` and `preset_exceptions` of
  the overview, and a link's row in the link list shows the same label. The rendered preview stays the confirmation step.
- **Advanced stays.** Nothing was removed from Advanced or from the date control.
- **The six answers in the interface.** 1: a help text and the exceptions list; 2: the review lists what a re-apply
  resets, and re-applying is the same flow (choose the preset again); 3: the preset descriptions say approved photos travel
  with the updates; 4: above; 5: the label comes from the owner responses and is display only; 6: the review lists the
  `everyone` records of the public page as *left as it is* with the way out, and the exceptions list repeats it per record.
- **Not done here.** The PWA words each preset itself (id to message), so it does not call `GET …/sharing-presets`; that
  endpoint serves API and MCP clients. A preset id this client does not know (written by a newer application) is shown as
  its id, with the exceptions list, rather than hidden. Decision 36 and the shorter `publication-safety-check.md` are step 4.
- **Tests.** `PresetSection.test.tsx` (the review and apply, the acknowledgement, a stale review, too large at review and at
  apply, the revision conflict, left-as-is and needs-decision, the unsaved-edits block, focus return, the exceptions and
  their actions, the new-link picker), additions to `PublicationManager.test.tsx` (creation with and without a preset,
  applying to the public page, the Sharing check lines) and `MemberScopeDialog.test.tsx` (a collection member), and
  `e2e/sharing-presets.spec.ts` with axe (a draft link in both locales and themes at 390 px, an active link needing the
  acknowledgement and the public page at 1440 px); `e2e/mock-api.ts` gains `mockSharingPresets`. Screenshots were checked
  locally (not committed).


## Step 4 implemented: documents, the shorter check and the final regression

Shipped (Closes #241). Documents and tests only; no behaviour changed.

- **`docs/publication-safety-check.md`** now starts from the audience, its preset and its exceptions list instead of one
  line per kind of record. It opens with *What the app already guarantees* (nothing to tick: no address, booking, note
  or document delivered, approved copies only, expiry and revocation, widening acknowledgement, a preset never writing
  `everyone` or touching another audience, per-audience date caps, per-link exclusions, and, said plainly, that
  `everyone` means everyone and a preset is a template, so a later `everyone` record still reaches a link). What
  remains are the checks a person must make: the preset's review, the exceptions list and the `everyone` records,
  the Sharing check lines (dates, future transport, what a link leaves out), reading the rendered preview for
  words, images, places and lines, and lifetime and channel. **Count: 7 items per audience, plus 4 for a collection
  link, against 18 (24 with the collection section) before.** The issue's "about 15" was approximate; 18 was the
  figure for a trip view or link.
- **Decision 36** has a dated amendment (2026-11-07): presets as audience-scoped templates over the existing
  allowlists, that they change no allowlist or what a field can reveal, and the six answers.
- **`docs/domain-model.md`** was read against `sharing_presets.py`, the routers and the picker. Fixes: ideas and
  cancelled plans are never selected and not listed (only a visit that shows its time, a blocked record and an
  unapproved photo copy are listed as needing a decision); a review of a never-saved public view creates nothing and
  an apply creates it unpublished; added what a preset is not (a later `everyone` record still reaches the
  audience), and a short description of the owner interface and MCP discovery. `backend/README.md` describes the
  routes and tools.
- **Final regression** (`tests/test_sharing_presets_apply.py::test_after_each_preset_visitors_receive_the_preset_and_no_field_outside_the_allowlists`):
  a synthetic trip with a private value planted in every place a preset could leak one (location address, notes and
  display name; visit and stay notes; property, booking reference, contact; route booking reference, class, notes
  and an attached document; update private notes) is first shared with everything to learn the keys the allowlists
  can deliver. Then each preset is applied, through the real routes, to the published public view and to one active
  hidden link, with a second link as bystander. For each visitor response: exactly the preset's records, no key
  outside the maximal allowlist, none of the forbidden field names, no planted value, preset id or canonical id
  anywhere in the text, dates at month; and the bystander's response is byte-identical before and after. It
  found no bug. The existing tests keep covering `applied_preset` and `preset_exceptions` on the collection
  surfaces.
- **MCP** (acceptance item 5): `list_sharing_presets`, `preview_sharing_preset` and `apply_sharing_preset` call the
  same handlers as the REST routes (`routers/sharing_presets.py`); the tests assert the manifest (read, read, write
  with confirmation), the same review, `preset_widening_needs_acknowledgement` and `preset_preview_is_stale` as JSON
  in the error, the audit event and creation with a preset. Gap found and fixed: the layered discovery tests had no
  preset phrasing, so three `search_tools` queries were added.

### Acceptance of #241 and where it is satisfied

| Acceptance item | Where |
|---|---|
| A preset's effective output is covered by projection tests and shown in the Sharing check and preview before it goes live | `test_sharing_presets.py` (each preset's target, `test_the_review_matches_what_delivered_returns_for_the_planned_scope`, the randomised property test, no other audience changes), `test_sharing_presets_apply.py` (the final regression above); the review dialog (`PresetSection.test.tsx`, `e2e/sharing-presets.spec.ts`) and the Sharing check's "Preset: …" line (`PublicationManager.test.tsx`) show it before *Apply*; the rendered preview stays the confirmation step |
| Existing scopes and records keep their output after migration; presets only change what new choices default to | Migration 022 adds nullable columns only (`test_sharing_preset_label_migration_postgres.py`), `test_the_label_is_never_read_by_delivery`, the legacy golden tests (`test_legacy_scope_golden.py`, `test_legacy_exclusion_golden.py`), answer 1 (new records stay private) |
| Switching preset on a live audience asks for confirmation, with the widening warning from #27 and #32 | `test_widening_a_live_audience_needs_an_acknowledgement_and_a_draft_does_not`, `test_a_refused_widening_does_not_claim_the_revision`, the review dialog's acknowledgement (`PresetSection.test.tsx`), decision 36 amendment |
| `docs/domain-model.md`, decision 36 and `docs/publication-safety-check.md` describe presets and the shorter check | Step 4 (this PR) |
| MCP tools expose the same behaviour through the shared handlers | `test_sharing_presets_are_reviewed_over_mcp_without_storing_anything`, `test_a_sharing_preset_is_applied_over_mcp_with_the_same_rules_as_the_application`, the three discovery queries in `test_mcp_server.py` |
| Both locales and themes, narrow layouts, keyboard and screen reader | `e2e/sharing-presets.spec.ts` with axe (both locales and themes at 390 px, 1440 px), `pnpm locale:audit`, the dialog's focus return and guarded dismissal (`PresetSection.test.tsx`) |
