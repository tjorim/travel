# A Merge That Shows Visitors More Needs Acknowledgement

Decision: 2026-10-31, issue #27. Merging a private duplicate into a shared kept
location or area re-points the duplicate's stays, visits, routes and updates at a
record their audiences receive, so a live audience can start to read a place it
did not before. The merge preview reports that, and a confirmed merge needs a
separate acknowledgement. Narrowing keeps its existing warning and needs none.

## What counts as widening

Per duplicate, a live audience (`audit.live_audiences`: the published public page
and active links; drafts and an unpublished page deliver nothing) is widened when
a moved record is delivered to it and the merge makes that record read a place
the audience did not receive before:

- Location merge: the audience receives the kept location but not the duplicate,
  so the record starts to show the kept location's public name and exact point
  (`projection._embedded_location`, a route's map point). A cross-area merge also
  counts the kept area's rounded point when the audience did not receive the
  record's old area (the moved records change area with the location).
- Area merge: the audience receives the kept area (with a point) but not the
  duplicate area, so the records filed under it start to show that rounded point
  (`projection._share_place`). Stays follow their location and an update with a
  location follows it, so both count even though the area preview counts only an
  update's own chosen area.

`visitor_changes.merge_widening` computes this from `reached_by`, the same
delivery rule as the #32 location editor, and returns per audience the number of
moved `stays`, `visits`, `routes` and `travel_updates` (a record counts once per
audience). Records an audience does not receive widen nothing. The visibility of
the kept record, the duplicate and each moved record all take part, because
`reached_by` applies the sharing gate and the live scopes.

## API contract

Both previews (`POST /trips/{id}/locations/merge` and `/areas/merge`, and the MCP
`merge_locations`/`merge_areas` tools) add `widened` to every duplicate:

```json
{ "audience": "public", "label": null, "stays": 1, "visits": 0, "routes": 0, "travel_updates": 0 }
```

`audience` is `public` or `link:<id>`; `label` is the owner's link label. The
preview also carries an English `warnings` entry for MCP readers; the PWA renders
the structured field.

A confirmed merge (`confirm: true`) with widening and without
`"confirm_widening": true` is refused with `409`:

```json
{
  "detail": {
    "code": "merge_widening_needs_acknowledgement",
    "duplicates": [{ "id": "<id>", "label": "…", "widened": [ … ] }]
  },
  "errors": [{ "code": "merge_widening_needs_acknowledgement", "params": {}, "path": [] }]
}
```

Nothing is stored. `confirm_widening` is a request field only: never stored or
returned, and null is rejected. A preview ignores it. The MCP tools take the same
argument and return the review as JSON text in the error; their own rejection
audit keeps only the code.

## Audit trail

`location.merge`/`area.merge` details keep, per merged duplicate and next to its
counts, `widened`: the audience ids with the four counts, only when there is any.
Like #32 it holds ids and counts, never a link label or any text.

## Choosing per record

Decision (owner), issue #27: instead of an all-or-nothing option, the owner picks
for each stay, visit, route and update that would newly reach an audience whether
it follows the merge as it is or is made private first. The choice is explicit per
record, so hiding from every audience is never a side effect, and
`confirm_widening` stays for whatever remains widened. Considered and rejected:
hiding every moved record at once, converting `everyone` records to `custom` for
the audiences that read them today, and a one-click "make the kept record private"
(it narrows what the kept record's other records show and drops its custom picks).

- **Preview.** Every duplicate also carries `widened_records`: each moved record
  the preview counts in `widened`, with `kind` (`stay`, `visit`, `route`,
  `travel_update`), `id`, its own `label` and `starts_on`, its `visibility`,
  `widened_for` (the audiences that newly read the kept place through it),
  `hides_from` (audiences that read it today and would lose it entirely),
  `custom_picks` (scopes listing it, which making it private removes for good) and
  `make_private` (whether this request chose it). A route between two merged
  duplicates is listed under both and is one choice. The list is owner-only and may
  name records; the audit trail never does.
- **Request.** `make_private` is a list of `{ "kind", "id" }` references, on a
  preview and on a confirmed merge. Only a record `widened_records` lists can be
  chosen; anything else (another kind, another record, a record whose sharing or
  audiences changed since the owner looked) is refused with `409`
  `merge_private_choice_is_stale` and a `records` list, and nothing is stored, so a
  record the owner did not review is never hidden. A preview with choices counts
  `widened` as what remains after them, which is what a confirmed merge then asks
  to acknowledge.
- **Effect.** After the acknowledgement check, each chosen record goes through
  `routers.visibility.choose_visibility`, the code behind `PUT
  /visibility/{kind}/{id}` and the MCP `set_visibility`: it is set to `private`,
  audited as a `record.visibility_change` with who stopped reading it, and
  withdrawn from every live and draft scope by the existing flush hook. All of it
  lands in the merge's transaction, so a refused merge hides nothing.
- **Audit.** `location.merge`/`area.merge` details gain `made_private`, a list of
  `{kind, id}` (ids only), next to the per-duplicate `widened` which, like the
  preview, holds what the owner acknowledged after the choices.
- **MCP.** `merge_locations`/`merge_areas` take `make_private` (the same list); the
  tool descriptions tell the agent to offer the choice per record, to pass only what
  the owner chose, and to re-preview after `merge_private_choice_is_stale`.

## Merge dialog

The preview step shows a region "Visitors who will see more". Per duplicate it
lists the audiences and counts that remain, then the newly shown records grouped by
kind (a group per kind, each row a checkbox named "Make … private first" with the
audiences it newly reaches, who else loses it and how many custom picks go with
it). Nothing is ticked by default. Ticking recomputes what remains and clears the
acknowledgement; when nothing remains the acknowledgement is replaced by a note and
Merge is enabled without it. The final confirmation names how many records are made
private first and how many custom picks are removed for good. Rows wrap and the
group's list scrolls inside the dialog at 360 px; every row is a checkbox in tab
order. If sharing changed after the preview and the server refuses (the widening or
a stale choice), the dialog replaces its preview with a fresh one, keeps the choices
that are still offered, and says so for a stale choice instead of a bare failure.

## Avoiding the widening

Beside the per-record choice, the owner can cancel and make the kept record private
first (its sharing control, or the MCP `set_visibility`); a private kept record
widens nobody. The dialog and the MCP tool descriptions say so.
