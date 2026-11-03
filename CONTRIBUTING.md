# Contributing to Hongxplore

Thanks for contributing. Read `AGENTS.md` first — it is the single source of truth for rules; this file expands the workflow for humans.

## Workflow — GitHub Flow

1. Pick up an issue from the [backlog](https://github.com/zsuryk/hongxplore/issues) (check its assignee, `Blocked by` edges, and labels first — `gh issue view <n> --comments`).
2. Branch off `main`: `feat/<issue#>-slug`, `fix/<issue#>-slug`, or `chore/<issue#>-slug`.
3. Open a **draft PR** early, reference `Closes #N`, then land work as incremental commits.
4. Mark ready for review when CI is green and the Definition of Done is met.
5. Squash merge (PR title becomes `main`'s history — it must pass commitlint).

## Project board

Every issue is a card on the [Hongxplore board](https://github.com/users/zsuryk/projects/1) with statuses `Backlog` · `Todo` · `In Progress` · `Done` · `Cancelled`. Move your own cards as you work — the board is the standup surface (`docs/PLAN.md` → standup rule); don't mirror board state into issue bodies. `gh` commands and the one-time Auto-add setup live in `docs/agents/issue-tracker.md`.

## Commits — Conventional Commits

`type(scope): imperative summary` — lowercase, no trailing period, subject ≤ 72 chars.

- **Types:** `feat` `fix` `docs` `chore` `ci` `refactor` `test` `perf` `build`
- **Scopes:** `api` `web` `data` `infra` `docs` (exactly the `area:` labels) — omit the scope for repo-wide changes.
- Examples: `feat(api): add /health endpoint`, `fix(web): clamp timeline drag offset`, `ci: add github actions workflow`.

CI runs `commitlint` on both the branch's commit range and the PR title. Local pre-check: `cd web && pnpm exec commitlint --from origin/main`.

## PR rules

- Draft first, then ready for review.
- **Required approvals = 0.** Per-path review is enforced by the `zone-guard` CI check: a PR that touches only your zone's paths merges with zero approvals; touching another zone stays red until that zone's owner approves. "Require review from Code Owners" stays OFF (GitHub's checkboxes are branch-wide and cannot express per-path gates on a personal plan). Nobody is exempt — if `zsuryk` genuinely needs to merge a cross-zone PR, he comments `zone-guard bypass` on it and the check passes.
- CI must be green: `api`, `web`, `commitlint`, `zone-guard`.
- Fill in the PR template (what/why, checklist). New dependencies must be noted in the PR body.
- One issue ↔ one PR ↔ one branch.
- **Stuck gate escape hatch:** if `zone-guard` (or any check) is genuinely stuck — for example the PR was approved while the gate was mid-evaluation and a flake left it red — rerun it from the Actions tab on that PR (Actions → the failed `zone-guard` run → "Re-run jobs"). A conversation comment with `zone-guard bypass` from the repo owner remains the bypass path that skips the check entirely.

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

This repo flips public on demo day. The checklist below was executed for the public flip on
**2026-11-03** (issue #90); re-run it before any later visibility change. Evidence is recorded in
that issue and its PR.

- [x] **Secrets scan:** scanned every commit and blob at scan time (131 commits) for provider keys,
      private keys, tokens and high-entropy strings. Only test fixtures, placeholders and mock
      values matched.
      The real values from the local gitignored `.env.deploy` do **not** appear anywhere in history.
      No `.env` file was ever committed — only `.env.example` and `.env.deploy.example`.
- [x] **GitHub Actions secrets/variables are empty:** `gh secret list`, `gh variable list` and the
      environment/dependabot secret endpoints all return nothing. The old keep-warm URL variable
      was removed so the public repo does not publish a deployment URL.
- [x] **`.gitignore` excludes env files and key material:** `git check-ignore -v .env.deploy api/.env`
      resolves to the `.env` / `.env.*` rules; `*.pem`, `*.key`, service-account JSON and similar
      credentials are ignored too.
- [x] **No deployment identifiers in the tree:** no live URL, cloud project number, revision name or
      provider credential is committed. `docs/DEPLOY.md`, `scripts/deploy-prod.sh` and
      `.env.deploy.example` use placeholders or resolve the URL from `gcloud` at runtime.
- [x] **License:** MIT (issue #17 / ADR-0007), `LICENSE` at the repository root.
- [x] **Personal data in tracked files:** no teammate full names or private contact details beyond
      GitHub handles. **Known exception:** git commit author names/emails were left unchanged by
      team decision; they are visible in history but are not secrets.
- [x] **No joke commits, no debug leftovers, no PRD-style files.** `git ls-files` contains no build
      output, `__pycache__`, `.DS_Store` or `dist/` artifacts.
- [x] **GitHub-hosted text and logs:** live URLs/revision names in issue and PR text were redacted,
      and the keep-warm Actions runs whose logs printed the URL were deleted. Two merged PRs'
      head-ref commit messages (#137 and #147) still contain the old URLs and cannot be edited
      without rewriting history; that residual is recorded in issue #90.

Useful commands if you need to re-verify:

```bash
# Any env/credential file ever committed?
git log --all --name-only --pretty=format: | sort -u | grep -E '(^|/)\.env($|\.)|\.pem$|\.key$|service-account'

# Runtime secrets, not just placeholders (expect test fixtures only)
git log -p --all | grep -iE 'sk-|tvly-|AIza|BEGIN .*PRIVATE KEY|ghp_'

# Env files are still ignored
git check-ignore -v .env.deploy api/.env

# GitHub-side stores
gh secret list && gh variable list
```

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
