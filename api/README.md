# Hongxplore API (FastAPI)

Backend for Hongxplore — see `../docs/ARCHITECTURE.md` for the v0 plan and `../AGENTS.md` for rules.

## Run

```bash
uv sync                      # install deps (creates .venv, writes uv.lock)
cp .env.example .env         # DEMO_MODE=true by default — no keys needed
uv run uvicorn app.main:app --reload --port 8000
curl localhost:8000/health   # → {"status":"ok"}
```

## Checks (run before saying "done")

```bash
uv run ruff format .         # format in place (CI uses --check)
uv run ruff check .
uv run mypy app
uv run pytest -x
```

## Contract regen (after ANY change to api models)

```bash
uv run python scripts/dump_openapi.py   # rewrites ../docs/openapi.json
```

Then in `../web`: `pnpm gen:types` (rewrites `src/api/schema.ts`). Commit all outputs together with any fixture change in `docs/examples/agent-response.json`.

## Layout

- `app/main.py` — FastAPI app + routes (scaffold: `/health` only)
- `app/config.py` — pydantic-settings env config (`OPENAI_*`, `TAVILY_*`, `DEMO_MODE`)
- `scripts/dump_openapi.py` — regenerates the OpenAPI contract snapshot
- `tests/` — pytest suite (asserts `/health` against the shared contract fixture)
