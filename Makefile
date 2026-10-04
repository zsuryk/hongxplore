# Root task runner for hongxplore. No new dependencies — plain make + bash.
# Every target here is a thin wrapper around the canonical commands documented
# in AGENTS.md; those commands remain the source of truth.

SHELL := /bin/bash
.DEFAULT_GOAL := help

.PHONY: help install dev check

help: ## Show available targets
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk -F':.*?## ' '{printf "  \033[36m%-8s\033[0m %s\n", $$1, $$2}'

install: ## One-time setup: install api (uv) and web (pnpm) dependencies
	cd api && uv sync
	cd web && pnpm install

dev: ## Run api (:8000) and web (:5173) together — demo mode, no keys needed
	@set -m; \
	trap 'kill -- -$$API_PID -$$WEB_PID 2>/dev/null || true' EXIT INT TERM; \
	( cd api && exec uv run uvicorn app.main:app --reload --port 8000 ) & API_PID=$$!; \
	( cd web && exec pnpm dev ) & WEB_PID=$$!; \
	printf '\n  api  http://localhost:8000/health\n  web  http://localhost:5173\n\n  Demo mode needs no API keys. Ctrl-C stops both.\n\n'; \
	wait

check: ## Full gate: api format/lint/typecheck/tests + web lint/typecheck/test/build
	cd api && uv run ruff format . && uv run ruff check . && uv run mypy app && uv run pytest -x
	cd web && pnpm lint && pnpm typecheck && pnpm test && pnpm build