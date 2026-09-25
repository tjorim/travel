# Domain model

One page to read before changing anything about records or sharing. The
detailed contracts are in
[the publication model](decisions/37-canonical-content-and-publication-model.md)
and [the privacy policy](decisions/36-privacy-sharing-offline-policy.md).

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
  owner boundary: a stay's property and booking, a spot's address, a raw GPS
  track, a photo original, a document original.
- **Twin**: a separately authored or reviewed share-safe copy, used only where
  the shared thing is a different artifact from the original (see below).

## What a record shows when it is shared

Each kind has a fixed allowlist. Nothing is redacted on the fly, and nothing
outside the allowlist can be selected.

| Record | Shared as | Never shared |
|---|---|---|
| Reisupdate | title, the text written for visitors, the date at its precision, its area | private notes, exact place, attached originals, exact time |
| Place, an *area* (city, region) | label, region, country, generalized point | timezone, notes |
| Place, a *spot* (a monument, a hot spring) | its public name, city, country, point, and directions | address, postal code, notes, provider ids, display name |
| Stay | its area and its nights, at the date precision chosen for it | property, exact place, booking, contact, notes |
| Route stage | label, summary, order, its area | |
| Transport leg | kind, status, carrier, service reference, city and country, schedule | booking reference, class, notes, documents; an endpoint appears on the map only when that place is itself shared |
| Broad route | label, reviewed line, date precision | the raw track behind it |
| Photo | an approved, metadata-stripped copy, with caption and alt text | the original and its EXIF |
| Document | an approved, redacted copy | the original |

## Where a twin is still needed

Twins are kept for **files and routes**, because the shared thing is a
different artifact: a photo derivative (stripped, resized), a redacted document
copy and a reviewed broad route. A place, a stay and a reisupdate are shared as
themselves through their allowlist, so there is no second record to keep in
step. A record that cannot be shared safely yet is refused with a reason: a spot
without a public name, a stay without an area, an update without text for
visitors, a copy that is not approved.

## The reisupdate

The one record for something that happened. It has a private part (notes, exact
place, attached photo originals) and a shared part (title, text for visitors,
date, area), held in separate fields so private text can never reach a visitor
by changing a switch. A quick capture creates a private update with only notes;
the owner writes the text for visitors later and then chooses who sees it.

A photo attached to a reisupdate travels with it (its approval is still the
gate); a loose gallery photo follows its own visibility.

## Behaviour to rely on

- New records are `private`.
- A scope can list only a `custom` record. Leaving `custom`, or deleting the
  record, removes it from every scope.
- `everyone` reaches every audience and cannot be narrowed for one link.
- *Delen* and each record's own editor set the same field, so they never
  disagree.

## Known gaps

- The `everyone` choice cannot be narrowed for one link.
- Nothing yet turns an exact place the owner already has into a named spot
  automatically; the owner names it in *Plekken delen*.
