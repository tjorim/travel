# MCP resource audience and Keycloak client discovery

Travel is the pilot for the shared MCP authentication contract of
[tjorim/apps#265](https://github.com/tjorim/apps/issues/265); this records the
application side ([#336](https://github.com/tjorim/travel/issues/336)).

## Contract

- **Canonical resource URL**: `TRAVEL_MCP_BASE_URL`, for example
  `https://travel.example.test/mcp`. A trailing slash is ignored. The protected
  resource metadata advertises it verbatim as `resource`, so it is the RFC 8707
  `resource` value a client sends and the audience Keycloak mints.
- **MCP audience**: exactly that URL, unless `TRAVEL_MCP_AUDIENCE` names a
  client-audience mapping instead. Startup refuses an MCP audience equal to
  `TRAVEL_OIDC_AUDIENCE`.
- **API audience**: unchanged, `TRAVEL_OIDC_AUDIENCE` (`travel-api`), checked
  only by `app.auth.current_subject` for `/api/*`. An MCP token does not
  authenticate the API and an API token does not authenticate MCP.
- **No proxy**: FastMCP's `KeycloakAuthProvider` is a `RemoteAuthProvider`. It
  serves RFC 9728 metadata naming Keycloak as the authorization server and
  verifies Keycloak's own JWTs; it issues, exchanges and refreshes nothing.
  Registration (CIMD or otherwise), PKCE, token exchange and refresh are
  Keycloak's, so direct Keycloak tokens are the only tokens in play and no
  FastMCP upgrade was needed. `TravelMcpAuthProvider` only pins the advertised
  resource to the configured URL: the stock provider appends the in-app mount
  path and advertised `.../mcp/`, which cannot equal an exact audience.
- **Discovery**: `mount_mcp` serves the metadata at the host root,
  `/.well-known/oauth-protected-resource/mcp`, which is also the
  `resource_metadata` URL in the 401 challenge. Caddy must route that path to
  the API (apps#226/#265).
- **Verification** (FastMCP `JWTVerifier`): Keycloak signature (JWKS), issuer,
  expiry, the `openid` scope and the audience above. The owner is the token's
  `sub`; tools never take a subject argument. Deletion and publication
  confirmation and the `mcp_audit_events` rows are unchanged.

A token is valid until `exp`; Keycloak session revocation takes effect when the
short-lived access token expires, because the verifier does not introspect.

## Connecting a client (clean cutover)

Remove the old Travel connector, then add the MCP URL again and sign in:

- Claude Code: `claude mcp remove travel`, then
  `claude mcp add --transport http travel <TRAVEL_MCP_BASE_URL>`, then `/mcp`.
- Claude Desktop / claude.ai, VS Code: delete the connector or server, add it
  with the same URL and authorize.
- ChatGPT: not supported yet. Keycloak's built-in CIMD rejects its metadata,
  and the replacement (custom executor or explicit registration) is undecided
  in apps#265.

Tokens issued for `travel-api` before the cutover are rejected by MCP.

## Evidence

Covered here by `tests/test_mcp_server.py` and `tests/test_auth.py`: discovery
and challenge, a real HTTP tool call acting as the token subject and writing
its audit row, and rejection of an API-audience-only token, another MCP
resource's token, a trailing-slash audience, a list or missing audience, wrong
issuer, expiry, missing scope and a foreign signing key.

Not covered by this repository, and tracked in apps#265: the isolated Keycloak
26.8 pilot (CIMD policy, resource allowlist, S256 PKCE, refresh, rejected
redirects and resources) and the recorded reconnect of each client.
