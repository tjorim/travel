# Create Records In Place, And Where Documents And Sharing Live

Decision note, 2026-11-07, issue #240 (part of #94). Builds on the closed #5 (the six-section
sidebar), which settled the chrome and not the structure of the sections.

## Create where the owner is looking

The agenda and the map are where an owner thinks in days and places, so they can now start the
record that belongs there. They open the **existing** visit, stay and route dialogs; nothing
new is built, and the dialogs keep their guarded dismissal.

| Entry point | Visit | Stay | Route |
|---|---|---|---|
| A day in the agenda ("Add" on the day row) | first day = the day; area = where the owner sleeps that night (the stay covering it, else the one left that morning) | check-in = the day, check-out = the next day; **no area** | departs on = the day; departure = where the owner sleeps that night |
| A map point (selected point's detail panel, or its list entry) | place = the location, else the area | area (and the saved location as the accommodation, as choosing it in the search does) | departure = the location, else the area |

Choices worth recording:

- **A stay from a day leaves the area to choose.** A new stay is usually somewhere else, and a
  wrong area saved by habit is worse than one empty field. A visit or a route from a day *does*
  take the area: they happen where the owner is.
- **An area stays editable.** A prefill is the dialog's initial value and not a constraint; the
  owner can change the place, and the dialog's dirty tracking starts from the prefilled values,
  so Escape on an untouched prefilled dialog closes without a prompt.
- **Only dated days.** The "No day yet" group has no day to prefill, so it has no menu.
- **No new routes, no hidden state.** The request is ordinary state of the trip workspace
  (`createRequest`), handled once by the matching manager in the plan and then cleared. It is not
  in the URL, the history, local storage or the server. The map lives on the overview, so asking
  from there also moves to the plan; the URLs stay `/trips/:id` and `/trips/:id/plan`.
- **Focus.** Cancelling returns focus to the control that asked (the day's "Add" control). From
  the map there is no such control on the plan, so it goes to the top of the plan (the agenda block's toggle).
  After saving, focus goes to the new record's row in the agenda (it is in the agenda because
  every record with a day, and every route or visit without one, is listed there) so the owner
  sees what was created. All of this is `RecordDialog`'s optional `returnFocus`.
- **The lists stay.** Areas, Visits, Stays and Routes remain the blocks below the agenda: the
  "All stays / visits / routes" view, with their own "New …" buttons, `#visits`-style hashes,
  the jump search and the `/trips/:id/plan` URL all unchanged.

## Documents and sharing: one home each, linked from the other place

Both used to be reachable from two places and each place did a different job. The decision is to
**keep both places, give each one job, and link them**, not to merge them.

| | Home | The other place | Link added |
|---|---|---|---|
| Documents | A **trip's** documents (tickets, bookings) live in that trip's *Prepare → Documents*. The **library** holds documents that belong to no trip (insurance, identity copies) and can link them to trips. | Library page | Trip documents → Library ("Go to library", always; the linked-documents card already had one). Library → Trips, with a note that a trip's own documents are kept in its Prepare section. |
| Sharing | **Deciding** what a trip shares (presets, per-record choices, links, preview) lives in that trip's *Sharing*. The top-level **sharing overview** is the *audit*: every link and collection across all trips, expiry and warnings. | Sharing overview | Trip Sharing → Sharing overview. The overview already linked each row to its trip's Sharing ("Open in trip"). |

Why not merge:

- A document that belongs to no trip has nowhere else to live, so the library cannot fold into a
  trip; and a trip's documents should be next to its tasks while preparing.
- The sharing overview exists to see across trips (a link that expires in a week, a collection
  that spans two trips). Folded into one trip it would lose that. Folding the trip's controls
  into the overview would put every trip's editor on one page.

Photos (created in Capture, managed under Story, chosen for visitors in Sharing) are a different
case: each step is a different job on the same record, and #241's presets reduce the third. They
are not changed here.

## Not done here

- Creating a record from a **route line** on the map (the line's end points are areas, covered by
  the point actions) and from a day with **no records** (the agenda lists days that have records;
  adding to a day nothing is planned on yet stays with the New buttons below the agenda).
- Showing the create actions on the **visitor** views: they never offer owner actions.
