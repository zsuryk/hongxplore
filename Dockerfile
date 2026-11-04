# syntax=docker/dockerfile:1
#
# One image, one process, one public URL (ADR-0006 / issue #87).
#
# Stage 1 builds the web app, stage 2 installs the API, and the runtime stage
# carries only those two artefacts. No build toolchain, no `.env`, no `node_modules`,
# no source maps with configuration baked into them. The runtime user is
# non-root and owns nothing it did not create.
#
# Deliberately no BuildKit-only syntax. `gcloud run deploy --source .` builds with
# `gcr.io/cloud-builders/docker`, which does *not* enable BuildKit, so
# `--mount=type=cache` fails there while passing on GitHub runners — which do
# enable it. CI pins `DOCKER_BUILDKIT=0` so the two builders cannot drift apart
# unnoticed again. Losing the pnpm/uv caches costs ~30s per rebuild.

# --- stage 1: build the web app ----------------------------------------------
# Node 22 rather than the 20 CI uses: 20 is past end-of-life, and this is a new
# long-lived artifact. The lockfile is shared, so the build resolves identically;
# only the runtime the bundler executes under differs.
FROM node:22-slim AS web

# pnpm is enabled through corepack so the pinned version in packageManager is
# the one used — a floating pnpm changes resolution between builds.
WORKDIR /build/web

RUN corepack enable

# pnpm v12 reads `overrides` from pnpm-workspace.yaml, not from package.json —
# it has to be copied before the frozen install or the lockfile config mismatches.
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# `web/src/api/schema.ts` and the fixture are generated from the contract, and the
# build imports both — so the contract snapshot has to exist before `tsc` runs.
COPY docs/openapi.json /build/docs/openapi.json
COPY docs/examples/ /build/docs/examples/
COPY data/activities.json /build/data/activities.json

COPY web/ ./
RUN pnpm build

# --- stage 2: install the API -------------------------------------------------
FROM python:3.12-slim AS api

# `tzdata` for Windows-style zones is already conditional in the dependency list;
# the container needs system tzdata for the HKT display rule to resolve.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/*

# Pinned to the uv that produced `api/uv.lock`. Installed via pip rather than
# copied from a registry image so the build depends on nothing but PyPI, and the
# version is explicit rather than "whatever the tag resolves to today".
ARG UV_VERSION=0.12.9
RUN pip install --no-cache-dir "uv==${UV_VERSION}"

WORKDIR /build/api
COPY api/pyproject.toml api/uv.lock ./

# Dependencies only, so an app-code change does not re-resolve the world.
RUN uv sync --frozen --no-install-project --no-dev

COPY api/app/ ./app/
RUN uv sync --frozen --no-dev

# --- stage 3: runtime ---------------------------------------------------------
FROM python:3.12-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/*

# Unprivileged, no shell, no home directory: there is nothing here to log into.
RUN groupadd --system --gid 1001 hongxplore \
    && useradd --system --uid 1001 --gid 1001 --no-create-home --shell /usr/sbin/nologin hongxplore

WORKDIR /app

COPY --from=api --chown=hongxplore:hongxplore /build/api/.venv /app/.venv
COPY --from=api --chown=hongxplore:hongxplore /build/api/app /app/app
COPY --from=web --chown=hongxplore:hongxplore /build/web/dist /app/web/dist

# The API's seed data is resolved relative to the package, and `app/` sits two
# levels deeper in the image than it does in the repo — which lands the default
# path on `/data/activities.json`. The loader already falls back to
# `cwd/data/activities.json`, and WORKDIR is /app, so placing it here is what
# makes demo mode work without touching that loader.
COPY --chown=hongxplore:hongxplore data/activities.json /app/data/activities.json

# `/tmp` is left exactly as the base image ships it (world-writable, sticky): it
# is the default SQLite cache location, and ADR-0006 records that cache as
# per-instance and ephemeral — never shared state, never persisted. Nothing here
# needs to survive the container.

USER hongxplore

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    WEB_DIST_DIR=/app/web/dist \
    DEMO_MODE=true

EXPOSE 8080

# Cloud Run ignores this and probes `/health` itself, but it makes `docker run`
# locally report the same readiness the platform will see.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD ["/app/.venv/bin/python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=2).status == 200 else 1)"]

# One process answers `/api/*` and the built web app from the same origin.
CMD ["/app/.venv/bin/python", "-m", "uvicorn", "app.webapp:app", "--host", "0.0.0.0", "--port", "8080"]
