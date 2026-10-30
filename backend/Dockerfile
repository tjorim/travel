# uv comes from its own FROM stage, not `COPY --from=<image>`: Dependabot's docker updater only reads
# FROM lines (dependabot/dependabot-core#5103), so this is what lets it propose uv bumps.
FROM ghcr.io/astral-sh/uv:0.13.6@sha256:af22a52f5eafef3d78e551599d405c02df61919d18028f0cea8eda93bc9986d0 AS uv

FROM python:3.15-slim AS builder

# h3 and PyYAML publish no CPython 3.15 wheels yet, so the builder compiles them. The runtime stage stays toolchain-free.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends gcc libc6-dev \
    && rm -rf /var/lib/apt/lists/*

COPY --from=uv /uv /usr/local/bin/uv

WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

FROM docker.io/mwader/static-ffmpeg:9.0.2-1@sha256:f5d100184884eb3e82b0eb14bb5ebf98da99826ac824989720297fb9ef21c822 AS ffmpeg

FROM python:3.15-slim

WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
# Only ffprobe ships: it verifies worker output. Encoding happens in the apps media worker.
COPY --from=ffmpeg /ffprobe /usr/local/bin/ffprobe
COPY backend/app ./app
COPY backend/alembic.ini ./alembic.ini
COPY backend/alembic ./alembic

ENV PATH="/app/.venv/bin:$PATH"

RUN groupadd --gid 1000 appgroup \
    && useradd --uid 1000 --gid appgroup --shell /bin/bash --no-create-home appuser \
    && chown -R appuser:appgroup /app

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
