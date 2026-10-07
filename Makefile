# Root task runner for hongxplore. No new dependencies — plain make + bash.
# Every target here is a thin wrapper around the canonical commands documented
# in AGENTS.md; those commands remain the source of truth.

SHELL := /bin/bash
.DEFAULT_GOAL := help

# Dev ports are fixed at the standard ones (README quickstart): api on 8000, web on
# 5173. Deliberately hardcoded rather than parameterized — 8000 is the convention, and
# web/vite.config.ts already hardcodes its /api proxy target to 127.0.0.1:8000, so a
# moved api port would silently break the proxy. A stale or foreign server on 8000 is
# reported by `preflight` so you can stop it rather than work around it.

.PHONY: help install dev preflight check

help: ## Show available targets
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk -F':.*?## ' '{printf "  \033[36m%-8s\033[0m %s\n", $$1, $$2}'

install: ## One-time setup: install api (uv) and web (pnpm) dependencies
	cd api && uv sync
	cd web && pnpm install

# Refuse to start on a taken port and name whatever holds it. Without this, uvicorn
# dies with a bare "Address already in use" and vite silently moves to the next free
# port, so the URLs printed by `dev` would be wrong and the run would look alive.
preflight:
	@for pair in api:8000 web:5173; do \
	  name=$${pair%%:*}; port=$${pair##*:}; \
	  if lsof -nP -iTCP:$$port -sTCP:LISTEN -t >/dev/null 2>&1; then \
	    printf '\033[31merror:\033[0m :%s (the %s server) is already in use\n' "$$port" "$$name" >&2; \
	    lsof -nP -iTCP:$$port -sTCP:LISTEN >&2; \
	    printf '  stop it:  kill %s\n' "$$(lsof -nP -iTCP:$$port -sTCP:LISTEN -t | tr '\n' ' ')" >&2; \
	    exit 1; \
	  fi; \
	done

# Foreground: Ctrl-C stops both. The URLs print only once both servers actually
# answer, so seeing them means the run is live; if either server dies the script says
# which one and stops the other, rather than hanging on `wait` in silence.
dev: preflight ## Run api (:8000) and web (:5173) together; Ctrl-C stops both
	@set -m; \
	trap 'interrupted=1; kill -- -$$API_PID -$$WEB_PID 2>/dev/null || true' HUP INT TERM; \
	trap 'kill -- -$$API_PID -$$WEB_PID 2>/dev/null || true' EXIT; \
	( cd api && exec uv run uvicorn app.main:app --reload --port 8000 ) & API_PID=$$!; \
	( cd web && exec pnpm exec vite --port 5173 --strictPort ) & WEB_PID=$$!; \
	ready=0; \
	for i in $$(seq 1 60); do \
	  if [ -n "$$interrupted" ]; then printf '\n  stopped during startup.\n'; exit 0; fi; \
	  if ! kill -0 $$API_PID 2>/dev/null; then printf '\033[31merror:\033[0m api exited during startup (see above)\n' >&2; exit 1; fi; \
	  if ! kill -0 $$WEB_PID 2>/dev/null; then printf '\033[31merror:\033[0m web exited during startup (see above)\n' >&2; exit 1; fi; \
	  if curl -fsS --max-time 2 http://localhost:8000/health 2>/dev/null | grep -q '"status":"ok"' \
	    && curl -fsS -o /dev/null --max-time 2 http://localhost:5173/ 2>/dev/null; then ready=1; break; fi; \
	  sleep 1; \
	done; \
	if [ $$ready -ne 1 ]; then printf '\033[31merror:\033[0m servers were not ready after 60s (see above)\n' >&2; exit 1; fi; \
	printf '\n  api  http://localhost:8000/health\n  web  http://localhost:5173\n\n  Both servers are up. Demo mode needs no API keys. Ctrl-C stops both.\n\n'; \
	while :; do \
	  if [ -n "$$interrupted" ]; then printf '  stopped both.\n'; exit 0; fi; \
	  if ! kill -0 $$API_PID 2>/dev/null; then printf '\033[33mstopped:\033[0m api exited on its own (see above)\n' >&2; exit 1; fi; \
	  if ! kill -0 $$WEB_PID 2>/dev/null; then printf '\033[33mstopped:\033[0m web exited on its own (see above)\n' >&2; exit 1; fi; \
	  sleep 1; \
	done

check: ## Full gate: api format/lint/typecheck/tests + web lint/typecheck/test/build
	cd api && uv run ruff format . && uv run ruff check . && uv run mypy app && uv run pytest -x
	cd web && pnpm lint && pnpm typecheck && pnpm test && pnpm build