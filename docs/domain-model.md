# Domain model

One page to read before changing anything about records or sharing. The
detailed contracts are in
[the publication model](decisions/37-canonical-content-and-publication-model.md)
and [the privacy policy](decisions/36-privacy-sharing-offline-policy.md).

## The records

Everything in a trip is one of these. The Dutch word is what the owner sees.

- **Area** (*gebied*): a city or region represented by one dot, with a label,
  country and an optional point rounded to two decimals and time zone. Never
  an address or a stored extent. Sharing an area never shares the locations in
  it. The owner map may show a hollow dot at the mean of its private location
  points when no area point has been saved; that mean is neither stored nor
  projected until the owner chooses **Gebruik als punt**, which rounds it.
  Focusing an area fits its dot and all its location dots in the owner map;
  the viewport is calculated for display and is not an area radius or boundary.
- **Location** (*locatie*): a hotel, station, monument or just a city, with an
  address and coordinates when known. It always belongs to exactly one area,
  and stays private until the owner gives it a public name and chooses who
  sees it. A new location goes into the area the owner picks, else into the
  area of its city (made when it does not exist yet), else into a private
  unnamed area (stored without a label; the interface shows its own
  translated fallback, and it cannot be shared until the owner names it).
  A new city-derived area starts at the location's generalized point when it
  has coordinates; an unnamed area never gets a point from a location. The owner
  can request an area suggestion from coordinates: the closest saved area
  within 25 km, otherwise a new area candidate from reverse lookup with a
  proposed IANA time zone. The suggestion never saves or silently re-files a
  location. The owner selects or edits it before saving.
- **Visit** (*bezoek*): a stop of the trip: an area, or a location in one, and
  optionally when: days, a start and end time (local at the visit, in the time
  zone of its area) and a kind (free or work). Getting somewhere is a route, not
  a visit. The day-by-day agenda is a read-only view over stays, routes and
  visits, not a record.
- **Stay** (*verblijf*): the nights slept at one accommodation. Every stay has
  an area and, once an accommodation is chosen, a location in it. Until then
  (*accommodatie nog niet gekozen*) the stay is filed under its area alone: no
  placeholder location is created for it. The stored area is the stay's own
  `area_id`, always equal to the area of its location when it has one.
- **Route** (*route*): how the trip gets from one area to another, by a travel
  mode (flight, train, bus, ferry, car, bike, walk or other). See below.
- **Reisupdate**: what happened, with a private part and a shared part. It can
  be linked to a location (private) and to an area (shared).
- **Photo** and **video**: files shared only as application-generated approved copies. Documents are always private.

**Giving a place.** Wherever a record points at a place (a visit, each end of a
route, a stay), the owner gives an area, a location, or both. A location
settles its area, so giving only the location is enough; an area given with a
location must be that location's own. The stored record always has an area.
For a stay the location is optional: `area_id` alone files it under that area
and creates no location, a later `location` chooses the accommodation, and
`location: null` returns it to the area (the area is kept). A location payload
that names nothing but an `area_id` means the same as the area alone. Moving a
location to another area, merging two locations, or merging two areas keeps the
stored area of every stay in step.

There is no record called "place". The word is only used for the search that
suggests a location (*locaties zoeken*, which suggests and never saves) and
for the one merged list of shared areas and locations in what a visitor
receives. In Dutch, *plaats* means a town, so it is not used for a location.

### How they relate

```
Area ◄── Location            a location is filed under exactly one area
  ▲          ▲
  │          │
  ├──────────┼── Stay        an area, and optionally a location in it
  │          │                (area-only until an accommodation is chosen)
  ├── Visit                  an area or a location; the area is always set
  ├── Reisupdate             area (shared) and location (private), both optional
  └── Route                  each end is an area or a location; both areas are
                             always set, the locations are optional
```

### The route

A route always runs between two **areas**, which is all a visitor ever sees of
its ends. The owner may name either end by a location instead, and the area
follows from it. The rest is optional and stays with the owner:

| Part | Required | Shown to visitors |
|---|---|---|
| Mode and status | yes | yes |
| Each end: an area, or a location (which settles the area) | yes | its area only |
| Name | no | yes (else "from → to") |
| Exact locations at either end (a station, an airport) | no | only if that location is itself shared |
| Schedule with time zones (both times or neither) | no | yes |
| Carrier and service number | no | yes |
| Booking reference, class, notes, documents | no | never |
| A hand-drawn approximate line with movable points | no | yes |

Without a drawn line the maps draw a straight one between the two areas (or
between the two locations when those are shared). A route is not derived from
anything recorded: the application stores no GPS tracks, live or finished.

## Words

- **Visibility**: a record's own choice of who receives it: `private` (the
  default, nobody), `everyone` (the public view and every hidden link, unless a
  link excludes it, see *Hidden links start from the public view*) or
  `custom` (only the audiences that list it). It is the source of truth for
  that record, and the same three choices apply to every shareable record.
- **Public view**: the one page for everyone, once published.
- **Hidden link**: a named, revocable, high-entropy link (`share_link`, the
  *unlisted* view).
- **Collection link**: one owner-wide, named, revocable link (`collection`) that opens an index of several trips; each member trip has its own scope. It has its own token, never a trip link's. The owner's *Sharing overview* lists every public trip, hidden link and collection in one place.
- **Scope**: what a public view or hidden link lists: the `custom` records it
  includes, the `everyone` records a hidden link or collection member leaves
  out (`exclude`), plus the trip title, summary and date precision, and the
  audience's own date precision (see *Date precision* below). It never names
  fields.
- **Private original**: something whose exact content must never leave the
  owner boundary: a stay's property and booking, a location's address, a route's
  booking, a photo original, a document original.
- **Twin**: an application-generated, reviewed share-safe copy, used only where
  the shared thing is a different artifact from the original (see below).

## What a record shows when it is shared

Each kind has a fixed allowlist. Nothing is redacted on the fly, and nothing
outside the allowlist can be selected.

| Record | Shared as | Never shared |
|---|---|---|
| Area | label, region, country, generalized point | time zone |
| Location | its public name, city, country, point, and directions; its address only if the owner also chooses that | address (unless chosen), postal code, notes, provider ids, display name |
| Reisupdate | title, the text written for visitors, the date at its precision (never finer than the audience allows), its area | private notes, location, attached originals, exact time |
| Stay | its area and its nights, at the date precision chosen for it and its audience | property, location, booking, contact, notes |
| Visit | title (else the shared location's name or the area's), the text for visitors, its area, the days at the precision chosen for it and its audience; the times only if the owner also chooses that (and only with full dates) | notes, the exact location (unless shared), the times (unless chosen) |
| Route | mode, status, its two areas, name, schedule, carrier, service reference, the drawn line | booking reference, class, notes, documents, the exact locations (unless shared) |
| Photo | an approved, metadata-stripped copy, with caption and alt text | the original and its EXIF |
| Trip cover | the id of the one chosen photo, only if that audience already receives the photo | any photo the audience does not receive; the choice itself |
| Document | never shared | the original and all metadata |

The public index cards on `/` and `/trips` also show the nominated cover, only
when the public projection receives it. They carry its scoped public file URL,
approved alt text, dimensions and focal point; nomination never delivers a photo.

## Hidden links start from the public view

Every audience starts from the **baseline**: the records set to `everyone`. A
hidden link or a collection member can then subtract and add:

```
received = (everyone records − the link's exclusions) + the link's custom records
           then minus whatever depends on an exclusion
```

`exclude` in the share scope lists baseline records (kind and id) the audience must
not receive. It is optional and additive, so a scope stored without it delivers
exactly what it always did, and a save that leaves it out keeps the stored list (an
older client can never widen an audience); `exclude: []` or `null` clears it. The
public view *is* the baseline and refuses `exclude` (`422 scope_exclusion_not_allowed`).
Nothing outside an audience's allowlist is ever delivered, and subtraction never
reveals a field.

**Dependencies.** A delivered document must not point at something the audience does
not receive, so one rule applies on the server, in `app/exclusions.py`, and nowhere
else: *excluding a record also hides, for that audience only, every record that
depends on it.*

| Excluded | Also hidden for that audience |
|---|---|
| Area | the locations filed under it; the visits, stays (including those filed under the area alone), routes and updates that use the area or one of those locations; and the photos of those updates |
| Location | the visits, stays, routes and updates that use it, and the photos of those updates (not its area) |
| Update | its photos |
| Photo | nothing; if it is the trip cover, the audience gets no cover |
| Visit, stay, route | nothing |

The rule applies to every record the audience would otherwise receive, `custom`
ones included: an exclusion is the owner's statement that this audience must not
read about the record. It is deterministic (it depends only on the trip's records),
and the same function filters the document, the file and navigation routes, the
collection entry and member page, the owner's preview and the Sharing check. The
owner API and MCP name what each exclusion also hides (`exclusions` on a link or
collection member, and `POST /trips/{trip_id}/share-scope/exclusion-review` or
`preview_share_link_exclusions` before saving).

An exclusion hides records, never words: authored text (the trip summary, another
record's title or body) is delivered as written and may still mention an excluded
area's name, so the owner reads the link's preview.

**Stale entries.** Only a record that exists and is still reached by the baseline
(set to `everyone`, or a photo attached to an `everyone` update) is excluded. A
stored id whose record was deleted, or is no longer `everyone`, is ignored, reported
as `stale`, and dropped by the next write. A write refuses an id that is not part
of the trip (`scope_unavailable`) unless the audience already stores it. A record
that cannot be shared right now (a cancelled visit, an update without text) keeps
its exclusion for when it can again.

**Widening.** Adding an exclusion narrows the audience and needs no confirmation.
Removing one from an *active* hidden link or collection member shows its visitors
records they do not receive, so the save is refused with
`409 exclusion_widening_needs_acknowledgement` (listing the records) until it is
repeated with `confirm_widening` (a field of the share-link update, a query
parameter of the collection member update, and an MCP argument). A draft needs
none. The change is audited like any scope change, with the ids added and removed
and the counts newly shown, never a label or other owner text; sharing-scope
revisions work as before ([decision 15](decisions/15-sharing-scope-revisions.md)).

## Date precision

How exactly a visitor reads *when* is decided in one rule, applied on the server
by `app/precision.py` in the same code path for the owner's preview, the Sharing
check and the real delivery: **the coarser value always wins**, so a visitor never
receives a finer date than either the record or the audience allows.

| Layer | Where it is set | Values |
|---|---|---|
| Audience | `defaults.date_precision` in the share scope of the public view, a hidden link or a collection member (*Dates shown to this audience*) | `day`, `month`, `year`, or absent |
| Visit, stay | its own `share_date_precision` (*Dates for visitors*) | `day`, `month`, `year`, or `null` = same as the audience |
| Reisupdate | its own `date_precision` | `day`, `month`, `year` |
| Trip dates | `trip.dates` in the scope, also capped by the audience | `day`, `month`, `year`, or absent (hidden) |

| Record's own value | Audience: not set | Audience: day | Audience: month | Audience: year |
|---|---|---|---|---|
| not set (follows the audience) | month | day | month | year |
| day | day | day | month | year |
| month | month | month | month | year |
| year | year | year | year | year |

In the owner's audience editor, *Dates shown to this audience* is the primary date control.
*How precise can the travel dates be?* (the trip dates row above) sits under the collapsed
*Advanced* disclosure beside the audience's `custom` record lists; the disclosure opens by itself
when the audience already shows trip dates or lists records, and nothing is rewritten when the
editor opens or saves unless the owner edits that control. Per-record *Dates for visitors*,
*Show the time* and *Also share the address* sit under *Advanced* in the visit, stay and
location editors in the same way ([#241](decisions/241-sharing-presets.md)).

An audience without a setting caps nothing, so a scope stored before the setting
existed delivers exactly what it always did (every record then holds its own value).
The only fallback is for a record that follows an audience that sets nothing: it
reads by `month`, the conservative default every new record always had. A new public
view, hidden link or collection member starts with an explicit `month`; saving a scope
that leaves `defaults` out keeps the audience's stored setting, so an older client can
never widen an audience, and `defaults: null` removes it. A time (`share_time`) only
shows on a full date, so a coarser effective precision hides it. The Sharing check
states each audience's setting, how many visits and stays read at each precision, and
how many are held coarser by their own setting. Before a trip starts (its start is after
the server's current UTC date; with no start, a route departs after that date) it also
warns, per audience, about the routes from today on that carry an exact time or a carrier
(`future_transport_times`) and the dates from today on shown by day (`future_day_dates`),
as counts only. It changes nothing, and it says nothing once the trip has started or ended
([#231](decisions/36-privacy-sharing-offline-policy.md#future-transport-and-dates-warning-231)). *Follow the audience's precision* sets
the own value of all visits and stays, or of one kind, to `null` in one step, after
showing which live audiences will read finer dates and asking for an acknowledgement.

### The visitor's day-by-day plan

The Plan reads the delivered document only ([#230](https://github.com/tjorim/travel/issues/230)). When
any visit or stay arrives at day precision, it adds **By day**: a section per calendar day with a dated
item, listing that day's visits, the routes departing that day (each once, never again on its arrival
day) and the stay, shown on its check-in day, as "Sleeping in" on each night between its two delivered
dates, and on its check-out day. Month and year records, undated visits and routes without a day are
not placed or ordered into a day; they follow under **Other plans** with their own precision. When no
visit or stay is shared by day, the three lists remain with a neutral note that exact days are not
shown. The client never counts nights, days or records it did not receive, and never reads a day from
record order, from a missing time or from a private record. A route's day is shared as entered whatever
the audience's precision, so routes alone never make an audience a day audience. Records already shown
with a story update (same area and day) are not repeated in the plan.

## Where a twin is still needed

Twins are kept only for **photos and videos**, where the application generates a different shareable artifact. Documents are always private, either in the owner-wide library or specific to a trip; neither home is published.
An area, a location, a route, a stay and a reisupdate are shared as themselves
through their allowlist, so there is no second record to keep in step. A
record that cannot be shared safely yet is refused with a reason: a location
without a public name, an update without text for visitors, a copy that is not
approved.

## The reisupdate

The one record for something that happened. It has a private part (notes,
location, attached photo originals) and a shared part (title, text for
visitors, date, area), held in separate fields so private text can never reach
a visitor by changing a switch. A quick capture creates a private update with
only notes; the owner writes the text for visitors later and then chooses who
sees it.

A photo attached to a reisupdate travels with it (its approval is still the
gate); a loose gallery photo follows its own visibility.

The **trip cover** is the owner's choice of one ready share copy of a photo
(`is_cover` on the copy, at most one per trip). It nominates; it never delivers:
each projection includes `cover` only when the chosen copy is among the photos that
audience already receives, so the cover can differ per audience or be absent, and
the same scoped file route serves it. Without one, or after the copy is deleted,
made private or withdrawn, the visitor page shows a text-only header. The owner's own
trip response carries `cover_url`, the authenticated file route of the chosen copy, for
the owner's screens only; no projection or visitor response includes it.

## Sharing presets (review only so far)

A preset is a named starting point for what **one** audience (the public view, a hidden link or a collection
member) receives, instead of a choice per record ([#241](decisions/241-sharing-presets.md)). It is a template: the
server plans it from the trip's records as they are now and writes it, once applying exists, through the
mechanisms above (`custom` plus the audience's `items`, the audience's `exclude`, `defaults.date_precision`). It is
never read at delivery: `projection.delivered` stays the one place that decides what an audience receives.

| Preset (`travel/sharing-preset@1`) | Selects | Dates |
|---|---|---|
| `story_only` | reisupdates with text, and their approved photos | at most `month` |
| `story_and_route` | the above, named areas and planned or confirmed routes | at most `month` |
| `planned_trip` | the above, planned or confirmed visits and stays | at most `month` |

A preset never writes `everyone`, so no other audience gains anything. A private record it selects becomes `custom`
and is listed for this audience only; a listed record it does not select is unlisted; on a hidden link or collection
member an `everyone` record it does not select is left out, unless leaving it out would also hide a record the
preset includes. The public view has no `exclude`, so its `everyone` records stay and the review lists them with the
way out. Locations (and with them addresses) and loose gallery photos are never selected or changed; times, ideas,
cancelled plans and anything that cannot be shared yet are not swept in and are listed as needing a decision.

**Review (read-only, owner-only).** `POST /trips/{id}/public-projection/preset/review`,
`POST /trips/{id}/share-links/{link_id}/preset/review` and
`POST /collections/{collection_id}/members/{member_id}/preset/review` take `{"preset": …}`, and
`GET /trips/{id}/sharing-presets` lists the definitions. MCP offers `list_sharing_presets` and
`preview_sharing_preset(trip_id, preset, audience)` (`public`, `link:<id>` or `collection:<member id>`) through the
same handlers. The review returns the planned `changes`, the records the audience receives before and after per
kind (computed by `projection.delivered` inside a transaction that is always rolled back), who would newly receive
or lose what (`widened`, `narrowed`; `requires_acknowledgement` for a live audience that would see more, the
widening of [#27](decisions/27-merge-widening.md)), the date precision before and after, `left_as_is`,
`needs_decision` and `replaces_exceptions`, and a `fingerprint` of the plan. A plan that would exceed the scope
limits (200 listed records, 500 exclusions) is not applicable: `refusal.code` is `preset_too_large`. A review stores
nothing, claims no revision and records no audit event, and no visitor response carries any of it.

## Behaviour to rely on

- New records are `private`.
- A scope can list only a `custom` record. Leaving `custom`, or deleting the
  record, removes it from every scope.
- `everyone` reaches every audience; a hidden link or collection member can
  exclude individual `everyone` records for itself only (the public view cannot).
- *Delen* and each record's own editor set the same field, so they never
  disagree.
- An area cannot be deleted while a visit, reisupdate, location or route still
  uses it.

## Known gaps

- Nothing yet turns a location the owner already has into a named location
  automatically; the owner names it in *Locaties*.
