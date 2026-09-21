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
| `GET` | `/published/trips/{public_id}` | Read an intentionally published unlisted/public trip. |

`GET /api/health` checks database connectivity. FastAPI publishes the full
OpenAPI description at `/openapi.json` and interactive development docs at
`/docs`; production routing may choose not to expose the latter.

Ownership is an API boundary, not a client convention: a non-owner receives
`404` for an owned resource. The published response excludes the owner subject
and only resolves trips whose visibility is `unlisted` or `public` and whose
publication state is `published`.

## Configuration and local checks

| Variable | Purpose |
|---|---|
| `TRAVEL_DATABASE_URL` | SQLAlchemy URL; PostgreSQL in production. |
| `TRAVEL_OIDC_ISSUER_URL` | Required issuer for production bearer-token validation. |
| `TRAVEL_OIDC_JWKS_URL` | Required JWKS endpoint for production bearer-token validation. |
| `TRAVEL_OIDC_AUDIENCE` | Expected API audience; defaults to `travel-api`. |

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
