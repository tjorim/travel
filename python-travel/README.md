# python-travel

Async owner-only Travel API client, separately installable with Python >=3.14.2.
No backend/ORM imports, Home Assistant dependency, visitor tokens or publishing API.

```sh
uv sync --frozen
uv run pytest
uv run ruff check .
uv run ruff format --check .
uv run ty check src
uv build
uv venv /tmp/travel-client-smoke
uv pip install --python /tmp/travel-client-smoke/bin/python dist/python_travel-0.2.0-py3-none-any.whl
/tmp/travel-client-smoke/bin/python -c 'from travel_client import TravelClient'
```

Contract tests live in `backend/tests/test_python_client.py` and exercise the actual
FastAPI application with synthetic SQLite fixtures through an aiohttp HTTP bridge.
Run `cd ../backend && uv sync --all-groups --frozen && uv run pytest tests/test_python_client.py`.
The bridge is test-only; the installed client depends on no backend code.

## Usage

Install into another project with `pip install ./python-travel` from the repository root.

Run `TRAVEL_ORIGIN=https://travel.example.test uv run examples/list_tasks.py`.
The example reads a short-lived API access token from standard input (never a CLI
argument), lists trips for explicit selection and reads tasks. It does not write.
For a standalone script use `async with TravelClient(origin, get_token) as client`.
For HA pass `session=async_get_clientsession(hass)`; closing the client never closes
that shared session. No owned session is created until entering its context.

The asynchronous supplier is called before every request; it must refresh tokens
proactively. Its failures become `AuthenticationError("token_unavailable")`.
401 becomes `AuthenticationError("authentication_required")`; the library never
refreshes/replays the failed operation itself. HA should map this to
`ConfigEntryAuthFailed` and invoke its OAuth reauthentication flow.

Select a trip with `await client.select_trip(id)` (checks owner access), then use
`tasks`, `create_task`, `update_task`, `complete_task`, `reopen_task`, `delete_task`.
Task completion sends the canonical boolean; the server sets the timestamp.
Packing lists use `packing_lists`, `create_packing_list`, `update_packing_list`,
`delete_packing_list`; items use `packing_items`, `create_packing_item`,
`update_packing_item`, `complete_packing_item`, `reopen_packing_item`,
`delete_packing_item`. Completion means packed, never a trip task or recurrence.
Optional create fields use the API's names; PATCH dictionaries preserve omitted
versus explicit null fields. Dates/times in inputs remain ISO strings. Response
models expose typed dates/times and stable IDs, ignoring additive server fields.

## Errors and privacy

All operations have a finite overall timeout (including the supplier) and a 2 MiB
response limit (identity encoding; automatic decompression is disabled). Cancellation propagates unchanged and releases the response.
A cancelled write may have committed; reconcile by reading. No requests are retried.
`TransportError.ambiguous` and `ProtocolError.ambiguous` flag uncertain write outcomes;
5xx writes are also ambiguous. Read state before deciding to submit another write.
`RateLimitError.retry_after` is seconds from a numeric or HTTP-date Retry-After;
wait at least that long before a caller-directed next attempt. There is no background
retry/sleep. `TravelError.status` and `.code` retain the structured first API error
code, never diagnostic prose, params or submitted values. No library logging occurs;
exceptions do not retain original transport errors or bodies. Caller HTTP tracing
and application logging must also redact credentials and authored content.

Only HTTPS origins are accepted except loopback HTTP for development. Credentials,
paths, query strings and fragments in base URLs are rejected; record IDs cannot
inject URLs or paths. Redirects are never followed. Supply a trusted, ordinary
unauthenticated aiohttp session without default auth, custom retry middleware or
credential-logging trace callbacks; the client supplies the API bearer header.

## Home Assistant authentication

Use HA's `OAuth2Session.async_ensure_token_valid()` in the supplier, then return
`oauth_session.token["access_token"]`. Obtain the initial grant through the HA
OAuth2 config flow with a dedicated public Keycloak PKCE client (no secret) and exact HA
callback URI, discovered from `GET /api/auth/oidc-config`. Request ordinary Travel API audience, `openid` and, when provisioned
and consented, `offline_access`; store refresh tokens only in HA config entries.
Unattended refresh uses the existing Keycloak token endpoint refresh-token grant.
Revoked/expired refresh grants require interactive HA reauth; do not retry writes.
No password grant, new integration secret scheme, service identity, MCP audience
or visitor/share token is supported. The dedicated client, consent/offline-session
policy, audience mapper, callback allowlist and revocation verification need the
infrastructure setup tracked in [tjorim/apps#333](https://github.com/tjorim/apps/issues/333). Until
that setup is verified, the library supports supplied API tokens but does not claim
that a production HA unattended login is already deployed. #319 owns HA config flow.

Primary references verified 2026-11-09:
- [HA 2026.11.0 Python requirement](https://github.com/home-assistant/core/blob/2026.11.0/pyproject.toml): >=3.14.2; client baseline tested independently of backend 3.15.
- [HA OAuth2 implementation](https://contributors.home-assistant.io/core/integrations/oauth2/)
- [HA API library guidance](https://contributors.home-assistant.io/core/integrations/api-library/)
- [aiohttp client API](https://docs.aiohttp.org/en/stable/client_reference.html)
- [Keycloak offline access](https://www.keycloak.org/docs/latest/server_admin/#_offline-access)

Daynest's package/session separation was reviewed through GitHub; Travel deliberately
omits its caching, SSE, integration keys and password/client-credential machinery.

## Compatibility and releases

0.2.0 targets the owner API contract shipped with #318. `identity()` returns
contract version 1 and the supported task/packing capability names. Unknown additive
fields are accepted; missing/invalid required fields raise a safe protocol error.
During 0.x, breaking library or wire-contract changes increment the minor version;
fixes increment patch. Keep the client version independent of the application.
Commit `uv.lock`; CI uses frozen installs on HA Python 3.14 and backend 3.15,
builds sdist/wheel and installs the wheel in an isolated environment. Release checks
are the commands above plus backend contract tests. Public PyPI publication/tagging
requires a separate release action; this change does not publish the package.

## Optional selected-source location

After explicit owner setup in Travel, `scope.live_sessions()` lists the trip's
owner-only source bindings. Send a single fresh point with
`await scope.push_position(session_id, observed_at=aware_datetime, latitude=12.345678,
longitude=45.678912)`. Travel validates the owner/trip/source session, enable state,
coordinate bounds, ordering, freshness and rate. The response's `accepted` is false
for an identical retry; no duplicate point is stored. The client never retries or
queues location writes, and never logs their payload. Discard a failed observation
and wait for fresh source data. OAuth credentials keep their existing owner powers;
selecting a trip/session is not a narrower credential grant. Track retention,
precision, deletion and backup semantics are defined in decision 244.
