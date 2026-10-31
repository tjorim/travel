# Failed owner and MCP authentication limit

## Status

Accepted on 2026-10-31 in [issue #46](https://github.com/tjorim/travel/issues/46),
a follow-up to #19. The shared signing-key cache and refresh throttle bound
outbound identity-provider traffic; this bounds the local token parsing and
signature verification that repeated bad tokens still cost.

## Decision

Each client is allowed **20 failed bearer-token verifications per 60 seconds**
(`TRAVEL_AUTH_FAILURE_LIMIT`, `TRAVEL_AUTH_FAILURE_WINDOW_SECONDS`). After the
twentieth, every request from that client that carries a bearer token is refused
with `429`, `Retry-After` (whole seconds until the window ends) and
`Cache-Control: no-store`, before its token is parsed or verified. The body is
the fixed `rate_limited` error and never contains token data. **Recovery is
automatic when the window ends**: counting restarts from zero and no operator
action is needed. `TRAVEL_RATE_LIMIT_ENABLED=false` turns the limit off with the
visitor limits.

What counts: a token that was checked and refused (forged, malformed, wrongly
signed, expired, wrong issuer or audience, unknown key ID). What never counts:
a successful request, a request with no bearer token (an MCP client's first
request legitimately has none), the `503` for unconfigured validation, and any
failure caused by the identity provider being unreachable, including the
refresh cool-down that follows it. Successes do not reset the count.

The client key is the one in `app/ratelimit.py`: the peer address, or
`X-Real-IP` when the peer is a private (trusted proxy) address, with IPv6
grouped by /64 and IPv4-mapped addresses folded to IPv4. A public peer cannot
choose its own bucket.

The owner API applies it in the `current_subject` dependency. The MCP route
applies it in `AuthenticationFailureLimiter`, an ASGI middleware added outside
FastMCP's own authentication (which runs before any middleware passed to
FastMCP) so a throttled client is refused first. FastMCP's verifier hides
outages behind the same `None` as a bad token, so `OutageAwareJWTVerifier`
notes failed key fetches for the middleware.

## Consequences

- Counters are fixed windows held in this process. Each uvicorn worker has its
  own, so the effective limit is multiplied by the worker count;
  `backend/Dockerfile` runs one worker, and a change to that must move the
  counters to shared storage. A restart clears them.
- Memory is bounded to 10,000 clients. When full, expired windows are dropped,
  then the oldest. An attacker rotating through that many addresses can evict
  others' counts; the limit then fails open rather than growing memory.
- A client over the threshold is refused even with a valid token until its
  window ends, since refusing before verification is the point. Users sharing
  an address (NAT, or any untrusted proxy path) share a bucket, so a noisy
  neighbour can lock them out for at most one window. The `Retry-After` value
  tells a client when to retry.
- Needs no Caddy or deployment change: the proxy already forwards `X-Real-IP`
  for the visitor limits.
