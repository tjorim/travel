# Travel

The Travel application: a FastAPI backend and a React owner PWA with live
public and unlisted trip views. Trips are created in the application.

This public repository starts with cleaned code history. Historical issue and
pull-request references belong to a private archive and are not publicly
accessible; new reports and contributions use this repository. Personal
instance data and recovery copies remain outside public source.

Retired archive data is preserved privately in application object storage.
Old archive URLs are not preserved.

- [PLAN.md](PLAN.md) — ordered work and TODOs
- [CHANGELOG.md](CHANGELOG.md) — implemented changes
- [Privacy, sharing and offline policy](docs/decisions/36-privacy-sharing-offline-policy.md) — v1 access, named-share-link, and redaction contract
- [Canonical content and publication model](docs/decisions/37-canonical-content-and-publication-model.md) — application data, storage, and projection contract
- [Live browser route and projection contract](docs/decisions/103-live-browser-route-contract.md) — owner, public, and unlisted browser routes and delivery safeguards
- [Fresh launch route boundary](docs/decisions/101-legacy-route-transition.md) — route ownership without archive import or URL aliases

## Run locally

See [Application backend](#application-backend) and
[backend/README.md](backend/README.md) for the API, `frontend/` for the PWA
(`pnpm dev`), or the [local application stack](#local-application-stack)
below. `pnpm dev` proxies `/api` to `http://localhost:8000`, so run the API
there. Locally neither a database container nor Keycloak is needed: the API
defaults to a SQLite file, built from the models with
`cd backend && uv run python -m app.dev_schema` (add `--reset` after a model
change). The Alembic migrations target PostgreSQL and do not run on SQLite. export one
`TRAVEL_DEV_AUTH_BYPASS_TOKEN` (any string) for both processes and start the API
with `TRAVEL_ENVIRONMENT=development`. `pnpm dev` then authenticates `/api`
with it, and opening `http://localhost:5173/admin/` is already signed in as the
fixed development owner (restart `pnpm dev` after exporting it). Without the
variable, `/admin/` uses Keycloak as in production.

## Local application stack

Production routing, secrets, backups and media storage live in the central
`apps` infrastructure ([apps#223](https://github.com/tjorim/apps/pull/223)).
Its VPS deployment playbook and upgrade script build `travel/frontend` with
the provisioned Node 24 and direct `pnpm install --frozen-lockfile` and
`pnpm build` commands.
Caddy there serves the built PWA shells and proxies the API; it no longer
serves static archive, so the archive's `private/` files are not published anywhere.
Owner access uses the Keycloak `travel` realm; public and unlisted visitors
use the application's scoped projection routes.

| Route | Served by | Access |
|---|---|---|
| `/` | `landing.html` shell | Public; lists currently published trips |
| `/trips/`, `/trips/<slug>` | `public.html` shell | Public projection of a published trip |
| `/share/<token>` | `share.html` shell | Unlisted capability link; `no-store`, `no-referrer`, `noindex` |
| `/admin/` | Owner PWA | Keycloak/OIDC owner sign-in |
| `/api/*`, `/openapi.json`, `/docs` | `travel-api` | Owner bearer token or scoped public/unlisted routes |

`compose.yaml` mirrors that boundary locally with Caddy, `travel-api` and
PostgreSQL:

```bash
(cd frontend && test "$(node --version)" = "v$(cat .node-version)" \
  && pnpm install --frozen-lockfile && pnpm build)
cp Caddyfile.example Caddyfile
docker compose up -d --build
docker compose exec travel-api alembic upgrade head
```

Then open `https://localhost`. Public and unlisted views work immediately.
This stack serves the built PWA, which always signs in through the production
`travel` realm configured in `frontend/src/auth.ts`, so owner sign-in succeeds
only if that Keycloak client accepts the local callback origin. For owner work
run `pnpm dev` and the API directly as described above.

### Publication safety review

Before publishing a trip or activating a share link, complete the short
[publication safety check](docs/publication-safety-check.md). It covers the
scope review, media metadata, and the response if something was shared by
mistake.

## Structure

- `frontend/` — React source for the owner `/admin/` PWA and live public and unlisted trip views
- `frontend/MAP-PROVIDER.md` — app map provider, attribution, privacy and failure policy
- `backend/` — application service, FastAPI routes and future owner MCP workflows
- `compose.yaml` — local Caddy, `travel-api` and PostgreSQL stack
- `Caddyfile.example` — local copy of the production owner, public and unlisted routes

## Application backend

`backend/` contains the FastAPI service for the Travel application. The API
stores only owner-scoped trip data: areas and locations, visits,
moments and travel updates, and owner-authorized media uploads/imports copied into
application-controlled object storage (with owner-only EXIF GPS surfaced when
present). It does not perform continuous or automatic location tracking.

For local development, install the locked dependencies and run the tests:

```bash
cd backend
uv sync --all-groups
uv run pytest
```

The production service requires `TRAVEL_DATABASE_URL` and a Keycloak/OIDC
validator configuration (`TRAVEL_OIDC_ISSUER_URL`, `TRAVEL_OIDC_JWKS_URL`, and
`TRAVEL_OIDC_AUDIENCE`), provided in production by the `travel` Keycloak realm
from apps#216. Local tests override the authenticated subject; CRUD fails
closed when token validation is not configured. `TRAVEL_DEV_AUTH_BYPASS_TOKEN`
authenticates a request bearing exactly that token as a fixed development owner;
startup refuses it outside `TRAVEL_ENVIRONMENT=development`. Apply schema changes with
`uv run alembic upgrade head`. Central deployment, PostgreSQL credentials,
backup coverage, media storage and Caddy routing live in the `apps` repository
(apps#215, apps#219 and apps#220).

Draft translation between Dutch and English is off until
`TRAVEL_TRANSLATION_API_BASE` names the internal, on-demand LibreTranslate
service from apps#252 (for example `http://translation-proxy:5000`). See
[docs/translation-drafts.md](docs/translation-drafts.md).

## UI maintenance

See [UI dependency and component maintenance](docs/ui-maintenance.md) for package updates, component provenance, upstream review commands and validation.
