# Architecture (v0 plan)

This is the technical plan teammates build against. Decisions are recorded as ADRs in `docs/adr/`; tickets live in `docs/PLAN.md` and the issue backlog. Nothing here is built yet beyond `GET /health` and the web hello page.

## High-level request flow

```
web  →  POST /api/agent
      → intent parsing (LLM, OpenAI-compatible endpoint)
      → Tavily search
      → normalise results
      → cache lookup / store  (keyed by normalised query + TTL)
      → rank
      → translate missing (Cantonese → English)
      → respond: Activity cards + match rationale + agent log
```

The response shape is fixed by the contract hub (issue #4): `docs/openapi.json`, the fixture `docs/examples/agent-response.json`, and generated `web/src/api/schema.ts`.

## Search cache decision

Tavily results are cached in a database keyed by **normalised query** with a TTL policy, so the same query isn't re-searched repeatedly. This is a general practice (avoid paid/redundant search calls, keep demos stable); the concrete database choice — **SQLite vs Postgres** — is an open decision tracked as **ADR-0005** (status `proposed`). The cache is behind an `ActivityCache` port (see the service seam below), so the DB choice doesn't ripple through the codebase.

## LLM provider abstraction

Use the official `openai` SDK pointed at **any OpenAI-compatible endpoint**:

- `OPENAI_API_KEY` — key
- `OPENAI_BASE_URL` — optional; overrides the endpoint for OpenAI-compatible providers (Ollama, vLLM, OpenRouter, …)
- `OPENAI_MODEL` — model name, set per developer

All three come from env via `api/app/config.py` (pydantic-settings). **Never hardcode or assume a specific vendor** in code, tests, or docs. CI runs with no keys at all (`DEMO_MODE=true`).

## Demo resilience

`DEMO_MODE=true` → agent endpoints serve bundled seed JSON (seed data lands via a later ticket, #7) instead of calling Tavily/LLM. The API's config and every future agent route must respect this flag so the pitch never depends on live network. The example `.env` ships with `DEMO_MODE=true`.

## Planned module layout (`api/app/`)

| Module | Contents | Zone |
| --- | --- | --- |
| `routes/` | FastAPI routers (`/health` now, `/api/agent` later) | Kyrus |
| `models/` | Pydantic models — `Activity` is the future single source of truth for the API contract | Kyrus |
| `config.py` | pydantic-settings: `OPENAI_*`, `TAVILY_*`, `DEMO_MODE`, cross-cutting policy (retries, timeouts, logging) | Kyrus |
| `services/` | Search, LLM, ranking, normalisation — behind `ports.py` Protocol interfaces | Korn |
| `prompts/` | Prompt templates (intent parsing, match rationale) | Korn |
| `tests/` | Backend tests (pytest) | Kyrus |

**Service seam:** `api/app/services/ports.py` holds `Protocol` interfaces (`SearchProvider`, `LLMClient`, `ActivityCache`) drafted by Kyrus alongside issue #4 and implemented by Korn. Route code depends only on the ports; the route never imports a concrete service. Cross-cutting policy (retries, timeouts, HTTP error mapping) is Kyrus's, defaulted in `config.py`; strategy inside a service (search approach, prompt sequencing, cache TTL semantics, ranking weights) is Korn's.

Ownership matrix: `docs/PLAN.md` → Part B.

## Frontend plan

- **React + Vite + TypeScript** (scaffolded now).
- **Infinite canvas**: custom DOM transform layer — pan/zoom/drag math lives in one place (viewport transform, not per-card positioning).
- **State**: Zustand store; card positions, timeline dock state, agent conversation log.
- **Types**: generated from FastAPI's OpenAPI snapshot (`pnpm gen:types` → `web/src/api/schema.ts`, generated — never hand-edit).
- **Fixtures first**: web is developed against `docs/examples/agent-response.json` until `POST /api/agent` lands (issue #9) — it never blocks on a live API.
- All user-facing strings in `web/src/copy.ts`.

## Environment variables

| Name | Purpose | Required when |
| --- | --- | --- |
| `OPENAI_API_KEY` | Key for the OpenAI-compatible LLM endpoint | Live LLM calls (not in `DEMO_MODE`, never in CI) |
| `OPENAI_BASE_URL` | Optional endpoint override for OpenAI-compatible providers | Using a non-OpenAI provider |
| `OPENAI_MODEL` | Model name to call | Live LLM calls |
| `TAVILY_API_KEY` | Tavily search API key | Live search (not in `DEMO_MODE`, never in CI) |
| `DEMO_MODE` | `true` → serve seed JSON, no network calls | Default `true` in `.env.example` and in CI |

Defined in `api/.env.example`; consumed by `api/app/config.py`.

## Explicitly deferred (future tickets, not v0)

- **Ingestion/scraping pipeline** — v0 leans on Tavily + seed data.
- **Authentication** — no users in v0.
- **Persistence beyond localStorage** — no DB until ADR-0005 is accepted.
- **Deployment target** — open decision, ADR-0006 (`proposed`).
- **Multiplayer boards.**
