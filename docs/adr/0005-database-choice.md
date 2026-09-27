# ADR-0005: Database choice (SQLite vs Postgres)

- **Status:** proposed  ← OPEN — decide before persistence lands
- **Date:** 2026-09-27

## Context

ADR-0003 caches Tavily search results in a database keyed by normalised query + TTL. v0 has no other persistence (no users, no accounts), and deployment is undecided (ADR-0006). The candidate options are SQLite (zero-ops, single file, perfect for local dev/demo) and Postgres (concurrent writers, managed hosting ready).

## Decision

*Open.* The cache is behind the `ActivityCache` port, so this choice does not block search work. A default proposal, once ADR-0006 settles deployment: **SQLite for v0/demo** (bundled, `DEMO_MODE`-friendly, no service to provision), **Postgres if/when a hosted multi-writer deployment exists**.

## Consequences

- Until accepted, no migrations/ORM land — schema work waits for this decision (tracked in the backlog).
- Choosing SQLite keeps the demo pitch fully self-contained; choosing Postgres early adds ops burden before there is a deployment target.
- Either way the port interface does not change; only its implementation does.
