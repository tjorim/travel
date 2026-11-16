# Owner Place Search Provider

Decision (#21, 2026-10-30): keep the public Nominatim service as the default.
The owner deliberately chose this provider for moderate, interactive use.
Review the [current Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/)
before deployment; verified on 2026-10-30.

The policy caps aggregate application traffic at one request per second,
requires application identification and attribution, prohibits autocomplete,
and prohibits submitting personal or confidential material. Availability is
not guaranteed. Search only for public place names; do not send private
addresses or confidential destinations. Results retain OpenStreetMap attribution.

Outbound search and reverse lookup share one in-process single-flight guard
and a minimum one-second interval between request starts. Cache hits do not
consume the budget. Busy/cooldown requests fail immediately with 429 and
Retry-After; provider failures return 503 and Retry-After. Failed requests
also consume the interval. Queries are not logged or stored persistently.
The owner UI submits public-place searches with Search or Enter, never typing;
saved-location autocomplete only searches Travel's own database.

## Deployment

Outside development, set **TRAVEL_OSM_PLACE_SEARCH_USER_AGENT** to an
application-identifying value with a real contact email or URL, for example
Travel/0.1 (contact: https://your-domain.example/contact). Startup rejects the
contact-free default. This is an application safeguard; the policy itself
requires identification, rather than explicitly mandating an email address.

Run only one API worker/replica against the public service. The guard is per
process, so multiple processes or other applications on the same host need a
shared aggregate limiter before scaling. The deployment owner must configure
the contact and single-process constraint in tjorim/apps.

TRAVEL_OSM_PLACE_SEARCH_API_BASE can switch to a compatible self-hosted or
contracted Nominatim endpoint without a software update. If usage exceeds the
public terms, select that alternative before increasing traffic; its deployment
is a separate infrastructure decision. No alternative provider is deployed here.

## Names of a result (#376)

A result is asked for with `namedetails=1` next to the English `accept-language`, so the display name stays the
English reading and the provider's raw name tags come with it. Three names are read from those tags and returned with
the result; nothing is stored until the owner saves an area or a location, and the response is kept only in the
in-process cache like the rest of the result:

- **`local_name`** is the plain `name` tag, which OpenStreetMap defines as the name used where the place is (in the
  local language and script). It is offered only when it differs from the English name of the result: the first part
  of `display_name`, or `name:en`. The comparison folds case only, so `Zürich` stays a local name next to `Zurich`.
  An editor that applies the result keeps it as the local name of the location; the area editor keeps it only when the
  result is the city or region itself (a station inside the city has a name of its own, not the city's).
- **`name_nl`** and **`name_en`** are the `name:nl` and `name:en` tags: suggestions for the Dutch and English labels.
  The owner applies them with one button; they are never part of the location that is saved, and the API refuses them
  on a location (leave them out when saving a result). A place without those tags has no suggestion: nothing is
  translated or guessed, and the plain `name` is never assumed to be Dutch.

A provider name that is blank, not text, or longer than a stored name (120 characters) is left out.

An area suggestion from coordinates (`areas/suggest`) offers no local name or Dutch and English names: its reverse
lookup finds the place at the point (a building, a station), not the city, so the provider's names would describe the
wrong thing. The owner types the area's local name, or searches for the city itself in the area editor.
