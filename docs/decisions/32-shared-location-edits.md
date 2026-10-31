# Edits To A Shared Location Reach Visitors

Decision: 2026-10-30, issue #32. Show the impact and ask for confirmation. A
shared location keeps its typo-fix flow instead of "make private, edit, share
again"; the point alone keeps that refusal.

## Visitor-facing fields

A location edit is visitor-facing when it changes what the projection
(`projection._share_shared_place`) publishes to an audience that receives the
location today:

- `label`, `locality` (the region) and `country_code`;
- `address_line1`, `address_line2`, `postal_code` and `admin_area`, but only
  while `share_address` is on. Turning `share_address` on or off lists the
  address parts that appear or disappear;
- `area_id`, because `_carry_links` moves every visit and route end at the
  location with it. Its audiences are those that receive any of the carried
  visits or routes, not the location itself.

`display_name`, `notes`, provider ids and the viewport are never published and
need nothing. A changed point is still refused with
`make_this_location_private_before_changing_its_point_then_share_it_again`,
acknowledgement or not.

## API contract

`app/visitor_changes.py` computes the review from `receivers()` over the live
audiences (`audit.live_audiences`: the published public page and active links;
drafts and an unpublished page deliver nothing). The merge preview (#27) reuses
its helpers.

`PATCH /trips/{id}/locations/{location_id}` refuses an unacknowledged
visitor-facing change with `409`:

```json
{
  "detail": {
    "code": "visitor_visible_change_needs_acknowledgement",
    "changes": [
      { "field": "label", "before": "A", "after": "B",
        "audiences": [{ "id": "public", "label": null }, { "id": "link:…", "label": "Family" }] },
      { "field": "area_id", "before": "<id>", "after": "<id>", "before_label": "…", "after_label": "…",
        "visits": 2, "routes": 1, "audiences": [] }
    ]
  },
  "errors": [{ "code": "visitor_visible_change_needs_acknowledgement", "params": {}, "path": [] }]
}
```

The same request with `"acknowledge_visitor_changes": true` is applied. The flag
is a request field only: it is never stored or returned, and null is rejected.
Validation failures (`422`) are raised before the review, and nothing is stored
when the review is returned. The MCP `update_location` tool takes the same field
and returns the review as JSON text in its error; its own rejection audit keeps
only the code, never the owner's text.

## Audit trail

An acknowledged change records `location.update` (target `location`) with, per
field, the field name and the audience ids that read it (`public`,
`link:<id>`), plus the visit and route counts for an area move. It deliberately
keeps no before/after text: addresses would outlive the 24-month audit window
as personal data, and the trail answers "what reached whom", not "what was said".
A change nobody receives, or a private location, records nothing.

## Editor

The owner editor shows, before saving, which edited text fields the location's
current recipients read. Saving sends the edit; a review answer opens a guarded
alert dialog with each field's before and after and its audiences. Confirming
resubmits with the acknowledgement; cancelling keeps the dirty draft and returns
focus to the save button. The server is the authority: the editor never decides
alone that an edit needs no confirmation.
