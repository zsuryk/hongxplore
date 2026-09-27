# Contributing to Hongxplore

Thanks for contributing. Read `AGENTS.md` first — it is the single source of truth for rules; this file expands the workflow for humans.

## Workflow — GitHub Flow

1. Pick up an issue from the [backlog](https://github.com/zsuryk/hongxplore/issues) (check its `Blocked by` edges and `Owner:` line first — `gh issue view <n> --comments`).
2. Branch off `main`: `feat/<issue#>-slug`, `fix/<issue#>-slug`, or `chore/<issue#>-slug`.
3. Open a **draft PR** early, reference `Closes #N`, then land work as incremental commits.
4. Mark ready for review when CI is green and the Definition of Done is met.
5. Squash merge (PR title becomes `main`'s history — it must pass commitlint).

## Commits — Conventional Commits

`type(scope): imperative summary` — lowercase, no trailing period, subject ≤ 72 chars.

- **Types:** `feat` `fix` `docs` `chore` `ci` `refactor` `test` `perf` `build`
- **Scopes:** `api` `web` `data` `infra` `docs` (exactly the `area:` labels) — omit the scope for repo-wide changes.
- Examples: `feat(api): add /health endpoint`, `fix(web): clamp timeline drag offset`, `ci: add github actions workflow`.

CI runs `commitlint` on both the branch's commit range and the PR title. Local pre-check: `cd web && pnpm exec commitlint --from origin/main`.

## PR rules

- Draft first, then ready for review.
- **Required approvals = 0.** Per-path review is enforced by the `zone-guard` CI check: a PR that touches only your zone's paths merges with zero approvals; touching another zone stays red until that zone's owner approves. "Require review from Code Owners" stays OFF (GitHub's checkboxes are branch-wide and cannot express per-path gates on a personal plan).
- CI must be green: `api`, `web`, `commitlint`, `zone-guard`.
- Fill in the PR template (what/why, agent used, checklist). New dependencies must be noted in the PR body.
- One issue ↔ one PR ↔ one branch.

## Definition of Done

Mirrors `AGENTS.md` → "Before finishing a task":

- [ ] `cd api && uv run ruff format . && uv run ruff check . && uv run mypy app && uv run pytest -x` green
- [ ] `cd web && pnpm lint && pnpm typecheck && pnpm build` green
- [ ] Contract regen (`dump_openapi.py` + `pnpm gen:types`) produces no diff if api models changed
- [ ] Full diff self-reviewed — no secrets, debug prints, or stray files
- [ ] PR body filled in; issue updated (comment or auto-close via `Closes #N`)

## When to open an issue

**Required:** anything expected to take >~1 hour, any feature, anything touching two areas, anything an AI agent will be assigned. **Optional:** trivial fixes (typo, one-line bug) may go straight to a PR whose description explains the change. See `docs/agents/issue-tracker.md`.

## Ownership

`.github/CODEOWNERS` names the zone owner for each path; the binding matrix lives in `docs/PLAN.md` → "Part B — Workstreams & ownership". Before touching a folder you don't own, get the zone owner's ack **in the issue**, not in the PR.

## Before making the repo public

This repo flips public on demo day. Before that:

- [ ] Scrub env & history for secrets: `git log -p | grep -iE 'sk-|api.?key|token|password'` and confirm GitHub → Settings → Secrets and variables → Actions is **empty**
- [ ] Decide a LICENSE (issue #16 / ADR-0007)
- [ ] Verify `.gitignore` still excludes `.env` and friends (`git check-ignore api/.env`)
- [ ] Check commit history and docs for teammate full names or other personal data beyond GitHub handles (handles are fine)
- [ ] Confirm no joke commits, no debug leftovers, no PRD-style files

## Running everything locally

```bash
# Backend (port 8000)
cd api && uv sync && cp .env.example .env && uv run uvicorn app.main:app --reload --port 8000

# Frontend (port 5173)
cd web && pnpm install && pnpm dev

# Checks
cd api && uv run ruff format . && uv run ruff check . && uv run mypy app && uv run pytest -x
cd web && pnpm lint && pnpm typecheck && pnpm build
```
