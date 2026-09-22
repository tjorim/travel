# Travel tracker API

The tracker API is a separate FastAPI application; it does not replace the
static archive or read its JSON, documents, or protected files.

## API contract

All routes use the `/api/v1` prefix. Owner routes require a bearer token whose
validated OpenID Connect `sub` matches the trip owner:

| Method | Route | Purpose |
|---|---|---|
| `GET`, `POST` | `/trips` | List the caller's trips or create a private trip. |
| `GET`, `PATCH`, `DELETE` | `/trips/{trip_id}` | Read, edit, or remove an owned trip. |
| `POST` | `/trips/{trip_id}/route-stages` | Add a broad route stage. |
| `PATCH`, `DELETE` | `/trips/{trip_id}/route-stages/{stage_id}` | Edit or remove a route stage. |
| `POST` | `/trips/{trip_id}/moments` | Add a chronological moment. |
| `PATCH`, `DELETE` | `/trips/{trip_id}/moments/{moment_id}` | Edit or remove a moment. |
| `GET` | `/published/trips/{public_id}` | Legacy: read an intentionally published unlisted/public trip. |
| `PUT` | `/trips/{trip_id}/public-projection` | Replace the trip's public scope; live immediately if already published. |
| `POST` | `/trips/{trip_id}/public-projection/preview` | Render the current scope for owner review (`no-store`), no gate. |
| `POST` | `/trips/{trip_id}/public-projection/publish` | Start serving the trip publicly at its current scope. |
| `POST` | `/trips/{trip_id}/public-projection/unpublish` | Stop serving the trip publicly. |
| `GET` | `/trips/{trip_id}/public-projection` | Read the current scope and publish state. |
| `POST`, `GET` | `/trips/{trip_id}/share-links` | Create or list named unlisted share links. |
| `GET`, `PATCH` | `/trips/{trip_id}/share-links/{link_id}` | Read, or edit a link's label/scope (draft or active; live once active). |
| `POST` | `/trips/{trip_id}/share-links/{link_id}/preview` | Render a link's current scope for owner review, no gate. |
| `POST` | `/trips/{trip_id}/share-links/{link_id}/activate` | Mint the capability token for a draft link (returned once). |
| `POST` | `/trips/{trip_id}/share-links/{link_id}/revoke` | Immediately invalidate an active link's token. |
| `POST` | `/trips/{trip_id}/share-links/{link_id}/rotate` | Revoke the current token and issue a fresh one for the same scope. |
| `GET` | `/public/trips/{slug}` | Anonymous: read the trip's current public scope, rendered live. |
| `GET` | `/shared/{token}` | Anonymous: exchange a valid, unexpired, non-revoked capability for its current scope, rendered live. |

`GET /api/health` checks database connectivity. FastAPI publishes the full
OpenAPI description at `/openapi.json` and interactive development docs at
`/docs`; production routing may choose not to expose the latter.

Ownership is an API boundary, not a client convention: a non-owner receives
`404` for an owned resource. The legacy published response excludes the owner
subject and only resolves trips whose visibility is `unlisted` or `public` and
whose publication state is `published`; new work should use the scoped
public/unlisted projection routes above instead, per
[#42](https://github.com/tjorim/travel/issues/42).

### Scoped public and unlisted publication links

A public or unlisted view never serializes a full trip: it always renders
live from current trip data, filtered to an explicit scope (which route
stages, moments, and title/summary fields the owner selected). Both the scope
and the content it selects are live — an owner can add, remove, or edit the
underlying items at any time, public or already-shared-and-active alike, and
visitors see the change on their next request with no separate republish
step. What *is* gated, and requires a deliberate owner action, is only
whether a page is being served at all: `publish`/`unpublish` for the public
view, and `activate`/`revoke`/`rotate` for a named unlisted link, since those
are the actions that turn access on or off rather than adjust what an
already-granted audience sees. A named unlisted link additionally gets a
256-bit capability token (`secrets.token_urlsafe(32)`) minted at `activate`;
only a keyed HMAC-SHA256 verifier is stored, the raw token is returned once
(at activation or rotation), and it must be handled like a credential (never
logged, analytics-tracked, or placed in page markup). Revoking or rotating a
link, or its expiry (1-90 days, default 30), is enforced on every
`/shared/{token}` request — there is no separate cache to invalidate because
delivery always re-checks live link state, and the response headers
(`Cache-Control: no-store, private`, `X-Robots-Tag: noindex, noarchive`,
`Referrer-Policy: no-referrer`) apply identically to a valid, expired,
revoked, or unknown token so a probe cannot be distinguished by caching or
indexing behavior.

## Configuration and local checks

| Variable | Purpose |
|---|---|
| `TRAVEL_DATABASE_URL` | SQLAlchemy URL; PostgreSQL in production. |
| `TRAVEL_OIDC_ISSUER_URL` | Required issuer for production bearer-token validation. |
| `TRAVEL_OIDC_JWKS_URL` | Required JWKS endpoint for production bearer-token validation. |
| `TRAVEL_OIDC_AUDIENCE` | Expected API audience; defaults to `travel-api`. |
| `TRAVEL_SHARE_LINK_SECRET` | Keys the one-way verifier stored for each unlisted share-link token. Required in production; the code default is development-only. |

Use a development subject header only with both
`TRAVEL_ENVIRONMENT=development` and
`TRAVEL_ALLOW_DEVELOPMENT_SUBJECT_HEADER=true`; it is rejected in production.

```bash
uv sync --all-groups
uv run pytest
uv run ruff check .
uv run alembic upgrade head
```

The initial migration can be reversed with `uv run alembic downgrade base`.
The central deployment in apps#215 must take a database backup before running
the first production upgrade. Its rollback is: stop `travel-api`, restore the
pre-upgrade database backup if it exists, or (only for a confirmed empty MVP
database) run `alembic downgrade base`, then deploy the previous API image.
