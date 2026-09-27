# ADR-0001: Monorepo layout (api / web / docs)

- **Status:** accepted
- **Date:** 2026-09-27

## Context

Hongxplore has a FastAPI backend, a React frontend, seed datasets, and a growing body of docs/decision records. Three teammates with different AI tools work concurrently and need a shared contract between backend and frontend.

## Decision

Use a single repository with top-level `api/` (Python/uv), `web/` (TypeScript/pnpm), `data/`, `docs/` (incl. `docs/adr/` decision log and `docs/agents/` skill config), and `CONTEXT.md` at the root. One issue tracker, one CI workflow, one PR flow across everything.

## Consequences

- One clone, one CI run, one number space — contract changes (`docs/openapi.json` ↔ `web/src/api/schema.ts`) land atomically in one PR.
- Language toolchains stay separate (uv on `api/`, pnpm on `web/`); there is no cross-build.
- Zone ownership (`api/`, `web/`, `data/`) maps directly onto folders, which is what `zone-guard` enforces per path.
