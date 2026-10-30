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
