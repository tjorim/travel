# uv comes from its own FROM stage, not `COPY --from=<image>`, so its version and digest sit on a
# FROM line that every Dockerfile updater (Renovate included) reads and bumps.
FROM ghcr.io/astral-sh/uv:0.13.7@sha256:96f40d3904aad8d0bd010539001d36c8e2188b981e1334471a90c4a1d93bb490 AS uv

FROM python:3.15-slim AS builder

# PyYAML publishes no CPython 3.15 wheel yet, so the builder compiles it. The runtime stage stays toolchain-free.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends gcc libc6-dev \
    && rm -rf /var/lib/apt/lists/*

COPY --from=uv /uv /usr/local/bin/uv

WORKDIR /app
# Resolve the local test-only client source; it is not installed in production.
COPY python-travel/pyproject.toml python-travel/README.md /python-travel/
COPY python-travel/src /python-travel/src
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

FROM docker.io/mwader/static-ffmpeg:9.0.2-1@sha256:f5d100184884eb3e82b0eb14bb5ebf98da99826ac824989720297fb9ef21c822 AS ffmpeg

FROM python:3.15-slim

RUN apt-get update \
    && apt-get install --yes --no-install-recommends libpango-1.0-0 libpangoft2-1.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
# Only ffprobe ships: it verifies worker output. Encoding happens in the apps media worker.
COPY --from=ffmpeg /ffprobe /usr/local/bin/ffprobe
COPY VERSION ./VERSION
COPY backend/app ./app
COPY backend/alembic.ini ./alembic.ini
COPY backend/alembic ./alembic

ARG APP_COMMIT=unknown
ENV APP_COMMIT=${APP_COMMIT}

ENV PATH="/app/.venv/bin:$PATH"

RUN groupadd --gid 1000 appgroup \
    && useradd --uid 1000 --gid appgroup --shell /bin/bash --no-create-home appuser \
    && chown -R appuser:appgroup /app

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
