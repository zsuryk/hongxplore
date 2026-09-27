# ADR-0003: Tavily search with query-result cache

- **Status:** proposed
- **Date:** 2026-09-27

## Context

The agent must research fragmented, partly Cantonese-only sources (LCSD portals, 活動站, district pages). Live web/event search on every request is slow, costs quota, and makes demos flaky. The same queries recur heavily during a session (users refine rather than re-ask from scratch).

## Decision

- Search via the **Tavily** API (`services/search/`), results **cached in a database** keyed by the **normalised query** plus a TTL policy, so the same query is never re-searched repeatedly. This caching approach is a general practice, not Hongxplore-specific.
- The cache sits behind the `ActivityCache` port (`api/app/services/ports.py`), so the storage backend is swappable.
- The concrete database (**SQLite vs Postgres**) is an open sub-decision — see **ADR-0005**.
- `DEMO_MODE=true` bypasses search entirely and serves seed JSON.

## Consequences

- Repeated queries return fast and free; demos are stable once warm.
- Stale results are bounded by the TTL; TTL semantics are a config key owned by the API lead, strategy inside the service is the data owner's.
- A real dependency: `TAVILY_API_KEY` is required for live search — never present in CI.
