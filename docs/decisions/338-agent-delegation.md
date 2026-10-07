# Consent-based read-only agent delegation

Spike [#338](https://github.com/tjorim/travel/issues/338). Keycloak's shared
flags, clients and FGAP V2 provisioning belong to
[tjorim/apps#265](https://github.com/tjorim/apps/issues/265) (section 4).
This records the application half, which is implemented and tested, and what
is still missing end to end.

## Decision

**Adopt the application contract; defer production delegation.** Travel now
refuses to trust a delegated token unless it satisfies every rule below, and
delegation stays off until an actor is explicitly allowed. Nothing enables
delegation in production: that needs the Keycloak work and a client that can
obtain the token, neither of which exists yet (see *Before production*).

## Token contract

A delegated token is a Keycloak access token from the standard token exchange
with an `actor_token` (RFC 8693). Keycloak documents this as **Preview**: it
needs `token-exchange-delegation` and `parameterized-scopes`, FGAP V2, a
confidential actor client with a service account, and a requesting client with
*Consent required*. Delegation consent is never stored, so the owner approves
each login session. The delegated token is access-token only, carries no
refresh token and is issued in a transient session.

Travel reads it as follows:

- **Owner**: `sub`. Every tool acts as this subject, as for a direct token.
- **Actor**: `act.sub`. Recorded separately; never used to select data.
- **Audience, issuer, signature, expiry, `openid`**: the same checks as any MCP
  token (`docs/decisions/336-mcp-resource-audience.md`). Keycloak takes the
  delegated token's `aud` and scopes from the actor client's configuration, so
  that client needs the MCP audience mapping.

`DelegationPolicyVerifier` additionally refuses (with the ordinary 401, no
tool run, no audit row) a token with `act` when:

| Rule | Setting |
| --- | --- |
| `act` is not an object with a non-empty `act.sub`, or is nested | — |
| `act.sub` is not listed (the list is empty by default: delegation off) | `TRAVEL_MCP_AGENT_ACTORS` (JSON list) |
| `act.sub` equals `sub` | — |
| the scope `travel:agent-read` is missing | `TRAVEL_MCP_AGENT_SCOPE` |
| `iat` or `exp` is missing, or `exp - iat` exceeds 900 seconds | `TRAVEL_MCP_AGENT_MAX_TOKEN_SECONDS` |

A token without `act` is an ordinary owner token and is unchanged.

## Tool boundary

A delegated token never gains the owner's ordinary tools merely because its
subject is the owner. `ToolFailureMiddleware` checks the tool name on every
dispatch, directly and through the `call_tool` proxy, before the tool runs:
only `MCP_AGENT_READ_TOOLS` (itinerary reads: trips, areas, locations,
visits, stays, routes, tasks, packing lists) plus `search_tools` and
`call_tool` are allowed. `search_tools` lists only those tools to an agent.
Writes, publication, share links, deletion, documents, media, the audit
trail, provider status, external place search and anything added later are
refused by default. A refusal is audited and returns a correlated tool error.
Token exchange itself is Keycloak's, never an MCP tool, so there is nothing to
widen from inside Travel.

## Audit

`mcp_audit_events` gains a nullable `actor_subject` (migration
`011_mcp_audit_actor`): `owner_subject` stays the data owner and
`actor_subject` is the agent, null for a direct owner call. Succeeded and
rejected calls, including refused tools, record both. No token, claim set or
request content is stored. The publication `AuditEvent` table has a different
vocabulary and cannot be reached by an agent, so it is unchanged.

## Lifetime and revocation

The token is valid until `exp` (at most 15 minutes by default). Travel does
not introspect, and Keycloak does not revoke an exchanged access token when
the subject token is revoked, so a revoked consent or removed `may_act` can
remain usable for the rest of that lifetime. There is no immediate
revocation; the short lifetime is the control. Removing the actor from
`TRAVEL_MCP_AGENT_ACTORS` stops it at once, at the cost of a restart.

## Evidence

`tests/test_mcp_server.py` covers, over the real HTTP mount with signed
tokens: a delegated read acting as the owner with both parties audited; the
refusal of write, deletion, publication, share-link, audit, document and
external-service tools both directly and through `call_tool`, leaving the
data unchanged; discovery limited to the allowlist; and 401s for an unlisted,
malformed, nested, self, unscoped, over-long, expired and wrong-audience
token, and for every delegated token while no actor is allowed. The
allowlist is also asserted to hold only existing, read-only, unconfirmed
tools.

## Can the client participate end to end?

Not yet; this spike did not run a Keycloak. The documentation gives the shape
above, but these are unverified until the isolated pilot in apps#265 runs:

- the exact value Keycloak puts in `act.sub` for client delegation (service
  account user id or client id), which the allowlist must match;
- that the delegated token carries `iat`, the configured scope name and the
  MCP audience;
- that a missing delegation consent silently drops `may_act` (documented),
  so the exchange fails rather than yielding a broader token.

## Before production

1. apps#265 section 4: provision the flags, FGAP V2 permissions, the actor
   client and the consent-required requesting client, then record the real
   `act` claim and fix `TRAVEL_MCP_AGENT_ACTORS` accordingly.
2. A bounded harness that holds the owner's consented token, performs the
   exchange with the actor token and hands only the delegated token to the
   agent. Without one nothing can obtain a delegated token; tracked in
   [#342](https://github.com/tjorim/travel/issues/342).
3. Re-evaluate once Keycloak promotes delegation from Preview, and decline
   the work if no client has a practical use for it.
