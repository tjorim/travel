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

## Merge dialog

The preview step shows a region "Visitors who will see more" with each duplicate,
the audiences and counts of moved records, and a checkbox acknowledging it. Merge
stays disabled until it is checked; the final confirmation is unchanged. If
sharing changed after the preview and the server refuses, the dialog replaces its
preview with a fresh one instead of a bare failure.

## Avoiding the widening

The owner can cancel and make the kept record private first (its sharing
control, or the MCP `set_visibility`); a private kept record widens nobody. The
dialog and the MCP tool descriptions say so.

## Open decision

Keeping only the moved records private (so they stop showing at all) is not
implemented: it would hide records visitors read today, for every audience
instead of only the widened ones, and drop custom-scope picks irreversibly, so
the issue body records it as an open decision. The same holds for a one-click
"make the kept record private" inside the dialog.
