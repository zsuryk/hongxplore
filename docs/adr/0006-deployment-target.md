# ADR-0006: Deployment target

- **Status:** proposed  ← OPEN — decide before deploying
- **Date:** 2026-09-27

## Context

Hongxplore needs a deployment target for demo day (API + web, likely static frontend + one backend process) but has no users, no auth, and no persistence yet. Candidates include a simple VPS, Fly.io/Railway-style PaaS, serverless functions, or GitHub Pages + a hosted API.

## Decision

*Open.* Deliberately deferred: v0 development runs entirely on `localhost` (API :8000, web :5173). Constraints to carry into the decision: the repo may go **public**, CI must stay keyless, and `DEMO_MODE` must keep the pitch runnable without live keys.

## Consequences

- No deployment config in scaffold PRs; any deployment PR first flips this ADR to accepted.
- Chosen target must accommodate the ADR-0005 database choice (SQLite implies single-node; Postgres implies a hosted DB service).
