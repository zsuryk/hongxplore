# Hongxplore

An infinite whiteboard + AI activity agent that helps international and non-local students in Hong Kong discover, translate, and schedule local activities.

## Background

International students in Hong Kong face chronic social isolation. Public facilities, grassroots recreation, and NGO cultural events are locked behind fragmented, Cantonese-only channels (LCSD portals, 活動站, district council pages, meetup groups) — students don't know what exists, how to book facilities, or when events happen.

Hongxplore's answer: you tell an agent what you're interested in and when you're free (natural language + time-slot chips). The agent researches those fragmented sources, translates Cantonese-only listings to English, dedupes, and returns results as **cards on an infinite whiteboard**. You drag cards onto a **weekend timeline** to align them with your free time, drag rejects to a discard bin, or click "find similar" to keep exploring. The agent can also surface facility-booking walkthroughs (how to book LCSD courts/pools), not just events.

Core interactions: search input + free-time chips → cards pop in → timeline alignment → discard → find-similar.

A standalone HTML prototype from earlier exploration lives in the separate `kulturecanvas` project as a historical reference.

## Status

**Scaffold only — no features yet.** The API serves `GET /health`; the web app renders a hello page. Everything else is planned, not built.

Start here: [`docs/PLAN.md`](docs/PLAN.md) (phased tickets + ownership) and the [issue backlog](https://github.com/zsuryk/hongxplore/issues).

## Quickstart

Prerequisites: Python ≥ 3.12 + [uv](https://docs.astral.sh/uv/), Node ≥ 20 + [pnpm](https://pnpm.io/).

**Backend** (port 8000):

```bash
cd api
uv sync
cp .env.example .env   # DEMO_MODE=true by default — no keys needed
uv run uvicorn app.main:app --reload --port 8000
```

**Frontend** (port 5173):

```bash
cd web
pnpm install
pnpm dev
```

**Health check:** `curl localhost:8000/health` → `{"status":"ok"}`

**All checks:**

```bash
cd api && uv run ruff format . && uv run ruff check . && uv run mypy app && uv run pytest -x
cd web && pnpm lint && pnpm typecheck && pnpm build
```

CI additionally lints commit messages and the PR title (`commitlint` job).

## Repository structure

| Path | Purpose |
| --- | --- |
| `api/` | FastAPI backend — routes, config, services, tests (Python/uv) |
| `web/` | React + Vite frontend (TypeScript/pnpm) |
| `data/` | Seed datasets (arrives with a later ticket) |
| `docs/` | Project documentation |
| `docs/adr/` | Architecture Decision Records — the decision log (no DECISIONS.md here) |
| `docs/agents/` | Engineering-skill config: issue tracker, triage labels, domain docs |
| `docs/examples/` | Shared contract fixtures used by backend tests and web mocks |
| `CONTEXT.md` | Domain glossary — read by the domain-modeling skill |
| `AGENTS.md` | Single source of truth for every human and AI agent |
| `CONTRIBUTING.md` | Workflow, commits, PR rules, pre-public checklist |

## Team & roles

| GitHub handle | Role |
| --- | --- |
| `zsuryk` | Backend / API lead, repo admin, docs owner |
| `kORNkin` | Data & AI integration (Tavily, LLM prompts), prompt engineering |
| `sweetpinejam` | Frontend |

Ownership details per folder live in [`docs/PLAN.md`](docs/PLAN.md) ("Workstreams & ownership") and are enforced by the `zone-guard` CI check via `.github/CODEOWNERS`.
