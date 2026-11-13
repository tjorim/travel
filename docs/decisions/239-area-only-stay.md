# An undecided stay is filed under its area alone (#239)

Decision of 2026-11-06 (owner): allow a stay with only an area until an
accommodation is chosen. No placeholder location is created for it.

## Model

A stay has `area_id` (required) and `location_id` (optional), the same shape as
a visit or a route end. The stored invariant that every stay resolves to an area
holds: the stay's area is its own `area_id`, and when it has a location the two
agree (`stay_place` in `services/placement.py` enforces it on create and update;
`that_location_is_not_in_the_chosen_area` otherwise). Everything that moves a
location or an area (`update_location`, `merge_locations`, `merge_areas`) moves
the stays with it.

## What visitors receive

Nothing changes. A delivered stay is its area (label, region, country, rounded
point when the area is shared) and its nights at the effective precision; its
location is embedded only when that location is itself shared. An area-only stay
has no location to embed. The allowlists in `projection.py` are untouched, and
`tests/test_area_only_stay_golden.py` compares the masked public and hidden-link
documents against a golden captured on the code that still created placeholders.

## The placeholder, and what migration 020 does with it

Before this change a stay given only an area was filed under one shared
"city-level" location per area (`area_location`): private, no label, no address,
no point, no notes, `locality` = the area's label, `country_code` = the area's
country. An owner may also have typed a generic "Verblijf in <city>" with the
area's own two-decimal point. The owner compares hotels by their **exact**
private location, so only city-level shells are converted; anything exact is
kept. A location is converted only when it is such a shell **and** only stays
use it:

| Location | Migration |
|---|---|
| private, nothing but `locality` (= area label, case-insensitive) and `country_code` (= area country), used by stays only, not named in any share scope | its stays become area-only; the location is deleted |
| the same shape, also used by a visit, a route end or a reisupdate, or named in a public view, hidden link or collection member scope | kept, stays attached |
| shared (`everyone` or `custom`), or with a public name | kept (this is the owner-named "Verblijf in &lt;city&gt;" kind: visitors may receive it) |
| with a display name, address, postal code, admin area, point, viewport, OSM or provider reference, notes, or a shared address | kept |
| a point with three or more decimals (also when unlabeled, with no address, on an idea stay), or a point that is not the area's own | kept (exact private data) |
| a private, unlabeled shell whose point has at most two decimals and equals the area's own point, with no display name or only "Verblijf in <area>" | its stays become area-only; the location is deleted |
| a city or country that differs from its area's | kept |
| placeholder-shaped but not used by any stay | kept (the migration only removes what it frees) |

When unsure the location is kept. The downgrade never takes anything away from a
visitor: every area-only stay gets a location again (an existing placeholder of
its area, else one new generic private location per area, as the old code made
them) before `location_id` is required again; it refuses to run when a stay and
its location disagree about the area, since the old schema cannot store that.
