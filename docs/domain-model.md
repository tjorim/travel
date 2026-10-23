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
  "Unassigned" area.
  A new city-derived area starts at the location's generalized point when it
  has coordinates; "Unassigned" never gets a point from a location. The owner
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
  a location and takes its area from it, so it needs no area of its own.
- **Route** (*route*): how the trip gets from one area to another, by a travel
  mode (flight, train, bus, ferry, car, bike, walk or other). See below.
- **Reisupdate**: what happened, with a private part and a shared part. It can
  be linked to a location (private) and to an area (shared).
- **Photo** and **video**: files shared only as application-generated approved copies. Documents are always private.

**Giving a place.** Wherever a record points at a place (a visit, each end of a
route), the owner gives an area, a location, or both. A location settles its
area, so giving only the location is enough; an area given with a location must
be that location's own. The stored record always has an area.

There is no record called "place". The word is only used for the search that
suggests a location (*locaties zoeken*, which suggests and never saves) and
for the one merged list of shared areas and locations in what a visitor
receives. In Dutch, *plaats* means a town, so it is not used for a location.

### How they relate

```
Area ◄── Location            a location is filed under exactly one area
  ▲          ▲
  │          │
  ├──────────┼── Stay        location (required); area comes from it
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
  default, nobody), `everyone` (the public view and every hidden link) or
  `custom` (only the audiences that list it). It is the source of truth for
  that record, and the same three choices apply to every shareable record.
- **Public view**: the one page for everyone, once published.
- **Hidden link**: a named, revocable, high-entropy link (`share_link`, the
  *unlisted* view).
- **Scope**: what a public view or hidden link lists: the `custom` records it
  includes, plus the trip title, summary and date precision. It never names
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
| Reisupdate | title, the text written for visitors, the date at its precision, its area | private notes, location, attached originals, exact time |
| Stay | its area and its nights, at the date precision chosen for it | property, location, booking, contact, notes |
| Visit | title (else the shared location's name or the area's), the text for visitors, its area, the days at the precision chosen; the times only if the owner also chooses that (and only with full dates) | notes, the exact location (unless shared), the times (unless chosen) |
| Route | mode, status, its two areas, name, schedule, carrier, service reference, the drawn line | booking reference, class, notes, documents, the exact locations (unless shared) |
| Photo | an approved, metadata-stripped copy, with caption and alt text | the original and its EXIF |
| Trip cover | the id of the one chosen photo, only if that audience already receives the photo | any photo the audience does not receive; the choice itself |
| Document | never shared | the original and all metadata |

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
made private or withdrawn, the visitor page shows a text-only header.

## Behaviour to rely on

- New records are `private`.
- A scope can list only a `custom` record. Leaving `custom`, or deleting the
  record, removes it from every scope.
- `everyone` reaches every audience and cannot be narrowed for one link.
- *Delen* and each record's own editor set the same field, so they never
  disagree.
- An area cannot be deleted while a visit, reisupdate, location or route still
  uses it.

## Known gaps

- The `everyone` choice cannot be narrowed for one link.
- Nothing yet turns a location the owner already has into a named location
  automatically; the owner names it in *Locaties*.
