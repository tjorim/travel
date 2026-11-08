# Publication safety check

Run this short review before publishing a trip's public view, activating or
rotating a named share link or collection link, adding a trip to a live
collection, or widening an already-live scope. The server enforces the scope;
this check is about choosing it deliberately.

The check starts from **the audience** (the public view, one hidden link or one
collection member), its **preset** and its **exceptions list**, not from one
line per kind of record. The app already counts, lists and renders what the
audience receives; you confirm that result and read the words only a person can
judge. There are **7 items per audience** (and 4 more for a collection link).
The earlier check had 18 items for a trip view or link and 24 with the
collection section ([#241](decisions/241-sharing-presets.md)).

## What the app already guarantees

Nothing below needs a tick. It holds for every audience and every preset, and
the tests cover it:

- Private is the default; a record reaches only the audiences its visibility
  and an audience's list select, from a fixed server-side list of fields per
  kind. **No address, booking, note, document or travel-party detail is ever
  delivered**, and a preset adds no field to any list.
- Only approved, metadata-stripped photo or video copies can be shared.
- **A published public view's link preview is a delivery surface.** Chat apps
  show the link's title, one-line summary and cover, built by the server from
  the same public projection (never from a private field) and only from what
  the public view shares; a hidden link's preview is always the generic Travel
  card. See
  [decision 103](decisions/103-live-browser-route-contract.md#link-previews).
- A hidden link or collection link expires and can be revoked; a revoked,
  expired or unpublished audience delivers nothing, and responses are `no-store`.
- Widening a live audience (a merge, removing a left-out record, letting
  records follow the audience's dates, applying a preset that adds records)
  is refused until you acknowledge it. Narrowing needs no acknowledgement.
- A preset **never writes `everyone` and never changes another audience**. It
  never selects a location (so never an address), a loose gallery photo, an
  idea, a cancelled plan, or a visit that shows its time; it caps an audience's
  dates at month at most and never makes them finer.
- Dates are capped per audience (*Dates shown to this audience*); the coarser of
  that cap and a record's own setting always applies.
- `everyone` means everyone: the public view and every hidden link and
  collection member receive it. **A preset is a template, not a filter.**

## For each audience

Complete these seven items for the public view and for each hidden link and
collection member, in the audience editor under *Delen* ("Sharing").

- [ ] **Start from a preset and read its review.** Choose *Story only*, *Story
      and route* or *Planned trip* (*Alleen het verhaal*, *Verhaal en route*,
      *Geplande reis*), or, for a new hidden link, *Same as the public page*
      on purpose. Press *Review preset* and read what the audience newly
      receives, what it stops receiving, the dates before and after, what
      "needs a decision" and what the apply resets. A draft delivers nothing
      yet; on a live audience, confirm only after reading the widening warning.
      Do not skip this because *Advanced* is closed: it opens by itself when an
      audience already uses what is inside.
- [ ] **Read the exceptions list and what the preset left as it is.** "Different
      from the preset" names every record received but not in the preset and
      every preset record not received, including records added since. Read the
      **`everyone` records**: a preset never changes them, so every one still
      reaches the public view and every hidden link (a link can leave them out
      under *Left out of this audience*; the public view cannot, so change the
      record's own visibility to *Privé* or *Zelf kiezen in Delen*, which changes every
      audience). Locations and loose photos keep their own visibility. A record
      you create later is *Privé* and joins nothing, but one you later set to
      *Iedereen* reaches this audience even though a preset was applied.
- [ ] **Read the Sharing check lines for the audience.** They state the effective
      date precision per audience (and what a record held to a coarser value
      does), the records a link leaves out and what that also hides (an area,
      location or update hides what uses it), and whether the audience gets a
      cover or map points. Before the trip starts they warn about future
      routes with an exact time or carrier and about dates shown by day: set
      those routes to *Privé* and the dates to month until you leave. A route's
      departure day follows the audience's date setting like every other date
      (by month it shows the month and no departure times), and its day counts
      in the dates-by-day warning, so the suggested month setting is what the
      route then shows.
- [ ] **Open the rendered preview and read every item as a stranger.** The
      shared words are yours and no rule can read them: titles, summaries, stage
      summaries, the text written for visitors in a *reisupdate*, public
      location names, captions, route labels. None may contain an exact
      accommodation, home or meeting address, a booking or confirmation code, a
      ticket, a travel-party name or contact detail, or a live or near-real-time
      location. The public view's title and summary are also what a chat app
      shows when the link is pasted, so read them as a card, not only as a page.
      An exclusion hides records, not words: a name you wrote yourself
      stays in the trip summary or another record's title. A shared stay shows
      only its area and nights, so check the area is not too specific, and a
      visit, stay or route grouped under an update of the same area and day does
      not reveal more together than apart.
- [ ] **Check every shared image.** For each selected photo or video look at the
      visible content and the caption. A photo of an update is also pinned on the
      map at that update's area, tying the two together. The cover is a photo
      like any other and also appears on the public index cards (`/` and
      `/trips`) with its alt text and crop, and it is the image of the public
      view's chat link preview; the Sharing check lists an audience that
      receives no cover.
- [ ] **Check the places and lines.** A shared location (a monument, a hot
      spring) shows its public name, city and point, so it must not be a home, a
      hotel or a meeting point. Presets never share locations, so any shared
      one is your own choice. A route is drawn with your line or a straight line
      between its two areas and shows stations or airports only when you share
      those locations; the line must not pass close to a home or meeting point.
- [ ] **Choose the audience's lifetime and channel.** For a named link choose
      the shortest sensible lifetime and send the capability only through a
      private channel. The public view is open to anyone and may be indexed; a
      chat app that has already shown its link preview may keep the title,
      summary and cover after you unpublish, and only that app can remove them.

## Also for a collection link

A collection link opens several trips with one URL, so a mistake reaches every
member. Complete the seven items above for **each member trip at its own member
scope** (a member scope is separate from the trip's own links, so do not assume
a member shows what that trip's "Family" link shows), and also:

- [ ] Read the collection title (if any) and each member's title, summary and
      dates in the index as a stranger would, and add only the trips this
      audience should know exist: the index names every member.
- [ ] Remember that `everyone` records reach every member and cannot be narrowed
      per member. Make a record *Privé* or *Zelf kiezen in Delen* if it must not reach the
      collection.
- [ ] A collection link is one capability: anyone who has it sees every member.
      Choose the shortest sensible lifetime, send it only through a private
      channel, and never paste a per-trip link into a collection or reuse one as
      the other.
- [ ] After removing a trip or revoking, expect the member pages to stop
      immediately, but not copies a recipient already holds.

Documents in the owner-wide library and in trips have no scope choice, visitor
field or file route, so there is nothing to check for them.

## If something was shared by mistake

1. Set the record back to "Privé" (or remove it from the scope, or leave it out
   of the hidden link), or unpublish the public view or revoke the link. Views
   are rendered live, so the next request no longer receives it; public and
   unlisted responses are sent `no-store`. A preset cannot be undone as a whole:
   apply a narrower preset to a hidden link, which leaves out what it does not
   include, or change the records themselves. The public view cannot leave an
   `everyone` record out, so change that record's visibility.
2. Rotate a named link or collection link if its capability itself reached the
   wrong people. To stop one trip only, remove it from the collection; to stop
   everything, revoke the collection.
3. If a public page was indexed, request removal of its URL in the relevant
   search-engine webmaster tools.
4. Treat any exposed booking code, ticket or document as compromised and
   follow its provider's procedure (rebook, cancel or reissue).
