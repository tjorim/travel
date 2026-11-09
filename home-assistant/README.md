# Travel for Home Assistant

Owner-only native to-do lists for explicitly selected Travel trips. Travel remains
the source of truth. Each trip has a task entity and one entity per packing list.
Five-minute polling discovers list changes; confirmed writes refresh immediately.
Location forwarding is optional and off by default (#244, see below). No
occupancy/security actions, Daynest cross-posting or visitor credentials are
implemented.

## Installation and OAuth dependency

Requires HA 2026.10.4 or newer and Python >=3.14.2. The custom integration is
versioned independently in `custom_components/travel/manifest.json` (0.2.0).
Production unattended authorization is **not yet verified/deployed**: provisioning
and end-to-end login/refresh/revocation checks are tracked in
[tjorim/apps#333](https://github.com/tjorim/apps/issues/333).

For development, copy `custom_components/travel` into HA's config directory and
restart HA. The manifest installs the separately packaged python-travel 0.2.0
from the immutable source archive pinned in the manifest, with its `python-travel` subdirectory.
This uses HTTPS, needs no Git executable, and does not claim a PyPI publication.
HA must have outbound access to GitHub and the dependency index. Development tests
use the local sibling package through uv; they never download an unpublished PyPI
name. Do not disable HA dependency installation for ordinary installation.

For HACS, add `tjorim/travel` as a custom Integration repository after an integration
release with `travel.zip` exists. Build it with `uv run python package.py` here;
attach `dist/travel.zip` to a GitHub release tagged `ha-v0.2.0`. The archive contains
only the integration directory contents, as required by `hacs.json`. Do not mark
a release available until its archive and dependency install have been tested.
First release tagging/HACS verification is tracked in [#329](https://github.com/tjorim/travel/issues/329).
Client PyPI publication is optional future release work; changing to a PyPI pin
requires publishing and verifying the package first. Integration release tags
must not be confused with Python client or application releases.

1. Provision a dedicated confidential Keycloak authorization-code client per
   apps#333, API audience mapper, owner consent and offline sessions. Disable
   password/service-account grants and allow exactly HA's callback (normally
   `https://my.home-assistant.io/redirect/oauth`); inspect the actual HA authorize
   request for your installation. The integration uses HA LocalOAuth2ImplementationWithPkce with
   a client secret and S256 PKCE; apps#333 must verify the deployed policy.
2. In HA Settings → Devices & services → Application credentials, add Travel.
   Set **Name** to the exact HTTPS realm issuer URL, for example
   `https://auth.example.test/realms/travel`; enter the dedicated client ID/secret.
   This explicit trusted realm supplies the authorization/token endpoints; there
   is no automatic discovery or forwarding of a Travel bearer token to an issuer.
3. Add Travel, enter its HTTPS origin without a path, sign in interactively, and
   explicitly select trips. OAuth requests `openid offline_access`; ordinary
   Travel API audience comes from the provisioned Keycloak mapper.
4. Configure changes the selection, including selecting none. Removed entities
   are removed from the registry on reload; removed packing lists disappear on
   refresh. Unloading cancels polling/listeners. Restart preserves identity.
5. Revoked/expired refresh grants or API 401 require interactive reauthentication.
   Sign in as the original owner; another subject is rejected. Updating HA's
   application credentials and reauth rotates credentials without changing entity
   IDs. Change of origin/owner requires a separate integration entry. Revoke the
   Keycloak offline session when removing the integration; delete unused HA
   application credentials separately.

## Supported semantics and failures

Tasks support create, rename, description, date-only due date, complete/reopen and
delete. Packing supports create, rename, description, packed/unpacked and delete;
no due dates, ordering or move features are advertised. Item UIDs are canonical
API IDs. Entity IDs hash origin/owner/trip/list, never tokens or titles. Task links,
reminder settings, packing quantity/bag/flags and other unsupported fields remain
unchanged by PATCH. HA's absent `None` fields are omitted; clear a description with
an empty string. Due-date removal is available in Travel; HA's item interface does
not distinguish an omitted due date from a request to clear it. Datetime inputs
are rejected rather than coerced into calendar dates. Reminder timestamps and
zones stay in Travel and are never rewritten by completing an item.

No optimistic updates or write retries occur. A timeout/cancellation may mean the
server committed; refresh/read before submitting again. Partial multi-delete may
succeed before a later item fails. A confirmed write followed by failed refresh
reports that distinction. Failed polling makes entities unavailable; API auth
failures trigger reauth. Error messages are local translations, never server prose.

## Privacy and examples

To-do item titles, descriptions and due dates are private content returned by HA's
to-do API to permitted HA users. Entity names contain selected trip/list titles;
standard state is the incomplete count. No extra trip/task attributes, links,
reminder timestamps or owner identifiers are added. Diagnostics use an allowlist
(version and update success only); they omit entries, URLs, IDs, credentials and
records. Avoid HTTP debug/trace logging in HA and dependencies.

HA recorder/history, logbook, dashboards, browser caches, third-party cards and
backups may retain entity names or item content. Restrict HA access, encrypt and
restrict backups (including `.storage`, OAuth tokens and application credentials),
and apply retention policies. Recorder exclusion does not remove existing history
or protect config-entry backups. Exclude these entities where appropriate:

```yaml
recorder:
  exclude:
    entity_globs:
      - todo.travel_*
logbook:
  exclude:
    entity_globs:
      - todo.travel_*
```

Check actual entity IDs in HA (renaming may change the pattern). Prefer explicit
entity lists for reliable exclusion. A minimal dashboard uses the selected entity:

```yaml
type: todo-list
entity: todo.synthetic_trip
```

A deliberate daily reminder based on incomplete count, without copying item text:

```yaml
alias: Travel preparation reminder
triggers:
  - trigger: time
    at: '18:00:00'
conditions:
  - condition: numeric_state
    entity_id: todo.synthetic_trip
    above: 0
actions:
  - action: persistent_notification.create
    data:
      message: Review your Travel preparation list.
```

## Checks and references

```sh
uv sync --frozen --python 3.14
uv run ruff check ../custom_components/travel tests package.py
uv run ruff format --check ../custom_components/travel tests package.py
uv run ty check ../custom_components/travel
uv run pytest
uv run python package.py
```

Tests use HA fixtures and the actual client over a synthetic local aiohttp API,
with no production session. API/client FastAPI contracts remain in
`backend/tests/test_python_client.py`. UI/browser testing is not required here.
Primary APIs checked 2026-11-09:
[HA OAuth/application credentials](https://contributors.home-assistant.io/core/integrations/oauth2/),
[to-do entity](https://contributors.home-assistant.io/core/entities/todo/),
[coordinator](https://contributors.home-assistant.io/core/integrations/fetching-data/),
and HA core's `config_entry_oauth2_flow.py`. Daynest's integration split and native
to-do platform were consulted; Travel adds no Daynest integration-key/SSE features.

## Optional live location (#244)

Tasks and packing work with location disabled (the default). No Dawarich or HA
history access is needed. In Travel's trip sharing tab, open **Live location and
private tracks**, add the exact `person.*` or `device_tracker.*` entity ID and
start collection. In HA's Travel options, select the location trip and then its
enabled source. Task-trip selection is independent. A different entity needs a
new Travel source; a person changing its underlying device keeps its identity.

Choose delivered precision independently for the public trip and each hidden
link in Travel. Saving affects active audiences immediately; connecting HA never
publishes anything. Existing link/public activation, expiry and revocation still
apply. Only current location is delivered. At one hour it is stale; at 24 hours
without fresh accepted data it disappears. Fresh data resumes still-enabled
audiences, while exact private tracks remain until explicit deletion.

The integration coalesces source events and sends at most every 45 seconds.
Unavailable/missing GPS and observations older than five minutes are skipped.
It has no history queue and never retries a failed position. A later fresh event
may send the current state. Control state is rechecked every 45 seconds; disabling
or deleting the Travel source removes listeners. Clear the location trip in HA
options to stop forwarding; reloading, unloading or disabling the HA entry cancels
its in-flight work. Stop the source in Travel to stop server acceptance and
visitor delivery immediately, including any request already on the wire. Re-enable
in Travel and reload HA to reconnect a stopped source.

Travel keeps exact tracks in its database, with owner inspection, explicit
private JSONL export and deletion. Ordinary trip JSON/PDF/Atom outputs contain no
tracks or live locations. Deletion clears the current position; stopping preserves
tracks. Travel backups can retain older data until backup rotation, and a restore
can restore deleted data. Configure HA recorder exclusions for selected entities
and review HA history/backup retention separately; this integration cannot remove
those copies. Never put location attributes in debug logs or automations that
forward them unintentionally. Production unattended OAuth still depends on
[apps#333](https://github.com/tjorim/apps/issues/333); access-token revocation takes
effect according to the existing OAuth token lifetime, not a new credential scheme.
