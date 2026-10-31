# API error descriptors (#285)

The application HTTP API adds `errors` alongside its existing diagnostic `detail`:

```json
{
  "detail": "Arrival must be after departure",
  "errors": [
    { "code": "arrival_must_be_after_departure", "params": {}, "path": [] }
  ]
}
```

Codes are explicit literals at the rejection source, independent of diagnostic
wording. `ApiException` preserves the HTTP status, diagnostic and headers;
`service_exception` retains typed service and Pydantic custom causes. The MCP
protocol continues to consume diagnostic exceptions and is never localized.
`ServiceError` is compatible with ValueError consumers; provider, place and media
errors also retain their RuntimeError ancestry.

Request validation uses Pydantic's type and complete location (including array
indices), with only numeric length/range/precision constraints allowed in
parameters. Responses omit `input`, error objects, URLs and arbitrary context;
malformed JSON has a fixed diagnostic. Router-required fields have body paths.
A structured `detail` object travels beside the descriptor when the client needs more than a
code: the 412 `scope_revision_conflict` carries the current owner record, and the 409
`visitor_visible_change_needs_acknowledgement` carries each changed field's before and after
and its audiences (see `decisions/32-shared-location-edits.md`). Neither reaches a visitor.
Resource dependency conflicts include per-kind counts and their total `count`.
Upload size failures include the numeric MB limit as `max_length`.

The frontend retains descriptors, separate diagnostic detail and status in
`ApiError`. Typed Paraglide whole messages are evaluated during render. Unknown
codes, malformed descriptors, old detail-only responses and non-JSON failures
use a localized operation fallback; a typed fallback function can supply
operation-specific context. Existing string fallbacks use the generic operation
message. New application fallbacks must retain typed message functions.
Network failures and stale authentication have dedicated messages in the
client. Server field mapping uses full dot-separated paths. Shared forms,
record dialogs, mutation notices, protected file downloads and owner previews
retain failures rather than translated strings, and subscribe to locale changes.

Public/share loading retains descriptors for error feedback, while all existing
403/404 unavailable states stay uniform. Visitor file and navigation links still
use native browser delivery; owner preview downloads use the common API fetcher.
No additional visitor projection fields, ownership data or capabilities are
included in errors. Unknown, revoked and expired share links have identical
bodies, codes and privacy headers. Byte-range rejections retain Content-Range.

## Audit inventory

| Sources | Rejections covered | Status/metadata behavior |
| --- | --- | --- |
| `auth.py`, `main.py` | Missing/invalid bearer, OIDC configuration, database health | Existing 401/503 status; no credential parameters |
| All `routers/*.py`, including placement and visibility | Owner lookup, required fields, conflicts, date/time checks, sharing gates, document/media attachments, dependency deletes | Existing 404/409/422 and provider 502/503 status; explicit codes and safe field paths/counts |
| `schemas.py` | Every custom validator plus built-in Pydantic failures | Stable custom type or built-in type, complete loc, numeric constraint allowlist |
| `access.py`, `projection.py` | Sharing blockers and scope selection | Typed blocker causes; existing diagnostic string API preserved |
| `document/service.py`, `library/service.py`, `media/service.py` | Upload, size, integrity, expiry, unavailable originals and derivative constraints | Typed ingestion causes; stored import failure_code now contains the cause code rather than truncated prose |
| `media/providers.py`, `media/oauth.py` | Provider connection, authorization, lifecycle, remote HTTP and malformed response failures | Typed safe diagnostics, never remote exception text, tokens, provider URLs or item capabilities |
| `translation.py`, `routers/translation.py` | Missing configuration, unreachable or malformed translation service, equal languages | 503 for the service, 422 for the request; never the submitted text, service URL or remote body |
| `places/search.py` | Provider configuration, HTTP/JSON failure, malformed results | Typed safe diagnostics with existing unavailable status |
| `media/ranges.py` | Status-only unsatisfiable range | 416 with existing range/cache/privacy headers and range_unsatisfiable code |
| `routers/publication.py` delivery and preview routes | Public/share unavailable projection, file and navigation targets | Uniform not_found code; existing diagnostic and privacy-header distinctions preserved |
| `ratelimit.py`, `routers/publication.py` delivery routes | Visitor rate limit | 429 with `rate_limited`, a fixed diagnostic that never names the route, slug or token, `Retry-After`, and the same `no-store` or unlisted privacy headers as the route's 404 |
| `authlimit.py`, `auth.py`, `mcp_server.py` | Too many failed bearer-token verifications from one client | 429 with `rate_limited`, a fixed diagnostic that never contains token data, `Retry-After` and `no-store` |
| Framework HTTP errors | Unmatched routes and other framework rejections | http_error descriptor alongside the existing status/detail/headers |

Tests reject bare HTTPException calls anywhere in the application-owned HTTP
surface. Backend contract tests exercise validation redaction, typed helpers,
status-only headers and provider redaction; existing ownership/publication tests
exercise the unchanged access and projection behavior. Frontend tests cover
mapped fields, known/unknown descriptors, transport and non-JSON failures,
authentication, retained mutation/form errors and locale switches, including
0/1/multiple dependency and selection counts.
