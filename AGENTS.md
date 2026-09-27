# AGENTS.md

## Purpose

Single source of truth for every human and AI agent working on this repo. `GEMINI.md` only points here; never duplicate rules elsewhere.

## Repo map

| Folder | Purpose | Owner |
| --- | --- | --- |
| `api/` | FastAPI backend: routes, models, config, services, prompts, tests | Kyrus (services/prompts: Korn) |
| `web/` | React + Vite frontend | Pax |
| `data/` | Seed datasets (JSON) | Korn |
| `docs/` | Project docs, ADRs (`docs/adr/`), skill config (`docs/agents/`) | Kyrus |
| `.github/` | CI workflows, CODEOWNERS, templates | Kyrus |
| Root docs | `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `CONTEXT.md`, `docs/PLAN.md` | Kyrus |

The binding ownership matrix is **`docs/PLAN.md` → "Part B — Workstreams & ownership"** — it, not this table, is authoritative for folder ownership.

## Hard rules

- **Never push to `main`.** Feature branch + PR only; never force-push shared branches. Prefer opening the PR as a **draft first**, then working in commits on it.
- **Never commit `.env` or secrets.** Only `.env.example` with placeholders.
- **The product PRD is out-of-repo.** Do not create `PRD.md`, `docs/PRD*`, or any PRD-style file. Do not create `CLAUDE.md` — nobody on this team uses Claude Code.
- **Do not copy the old static demo** (the `index.html` whiteboard from `kulturecanvas`) into this repo.
- **Timezone: Asia/Hong_Kong** — store UTC, display HKT.
- **All user-facing strings go in `web/src/copy.ts`** (English v1) — never inline in components.
- **No new dependencies** without noting them in the PR body.
- **Respect `DEMO_MODE`** in any future agent endpoint.
- Anything **>~1 hour or crossing two areas requires an issue first** (see `docs/agents/issue-tracker.md`).
- **Before touching a folder you don't own**, read the ownership matrix in `docs/PLAN.md` and get the zone owner's ack in the issue.
- **Ticket-first protocol (applies to EVERY agent — OpenCode, Codex, Antigravity — not only users of Matt's skills):** before writing code for a ticket, run `gh issue view <n> --comments` and read its acceptance criteria, `Blocked by` edges, and linked artifacts. The issue, not a chat log, is where work context lives.
- **Contract hub:** issue #4 is the single source of truth for API / service-seam / web-type questions. Its linked artifacts — `docs/openapi.json`, `docs/examples/agent-response.json`, `web/src/api/schema.ts` (via `pnpm gen:types`), and `api/app/services/ports.py` (once created) — are binding. If chat and these files disagree, the files win; fixing a mismatch is a PR, not a decision.
- **Zone reviews are enforced by the `zone-guard` CI check, not by a GitHub checkbox:** a PR that touches only your zone's paths merges with **zero approvals**; touching another zone keeps the check red until that zone's owner approves (owners: `docs/PLAN.md` ownership matrix + `.github/CODEOWNERS`). GitHub's own "required approvals" is deliberately set to 0 — the check is the gate.

## Commands to run before saying "done"

```bash
cd api && uv run ruff format . && uv run ruff check . && uv run mypy app && uv run pytest -x
cd web && pnpm lint && pnpm typecheck && pnpm build
```

**Contract regen (after ANY change to api models):**

```bash
cd api && uv run python scripts/dump_openapi.py
cd web && pnpm gen:types
```

Commit all three outputs together (`docs/openapi.json`, `web/src/api/schema.ts`, and the fixture `docs/examples/agent-response.json` if the model changed).

CI additionally lints commit messages and the PR title (`commitlint` job).

## Code style

- **Python:** `ruff format` is law; type hints on public functions; pydantic v2.
- **TS/React:** prettier is law; function components; named exports; strings via `copy.ts`.

**Commits — Conventional Commits, strictly:**

- Format: `type(scope): imperative summary` — lowercase, imperative mood, no trailing period, subject ≤ 72 chars.
- **Types (closed set):** `feat` · `fix` · `docs` · `chore` · `ci` · `refactor` · `test` · `perf` · `build`. Issue-label mapping: `feat`↔`type:feature`, `fix`↔`type:bug`, `chore`↔`type:chore`, `docs`↔`type:docs`.
- **Scopes (closed set):** `api` · `web` · `data` · `infra` · `docs` — exactly the `area:` labels, nothing else. **Never invent scopes** (`backend`, `frontend`, `server`, `app`, `agent` are all wrong — agent-endpoint/prompt work is still `feat(api): …` since it lives under `api/`).
- **Scope rule:** scope = the owning issue's `area:` label; omit the scope entirely for repo-wide changes (root, `.github/`, tracker/labels setup): `chore: add github labels`, `ci: add github actions workflow`.
- Examples: `feat(api): add /health endpoint`, `fix(web): clamp timeline drag offset`, `feat(data): seed 120 hk activities`, `docs(adr): record monorepo decision`, `refactor: extract copy.ts constants`.
- **Enforcement:** the type/scope closed sets above are encoded verbatim in `web/commitlint.config.js` and linted by the `commitlint` CI job on every PR — both the branch commit range and the PR title (squash merge puts the PR title into `main`'s history). Local pre-check: `cd web && pnpm exec commitlint --from origin/main`.

## Process

- Branch naming: `feat/<issue#>-slug`, `fix/<issue#>-slug`, `chore/<issue#>-slug`.
- PR references `Closes #N`. One issue ↔ one PR ↔ one branch.
- Agent sessions map to a single PR; a human reviews the full diff, not just the agent's summary.
- Log non-obvious decisions as a new ADR in `docs/adr/` (append, never rewrite history).

## Team & tools

| Person | GitHub handle | Role | AI coding tool |
| --- | --- | --- | --- |
| Kyrus | `zsuryk` | Backend / API lead, repo admin, docs owner | OpenCode |
| Korn | `kORNkin` | Data & AI integration (Tavily, LLM prompts), prompt engineering | Antigravity |
| Pax | `sweetpinejam` | Frontend | Codex |

If you are not the owner of a folder, ping the owner in the PR before changing it.

## Before finishing a task

- [ ] Commands above are green (format, lint, typecheck, tests, build)
- [ ] Self-reviewed the full diff for secrets / debug prints / stray files
- [ ] PR body filled in (what/why, agent tool used, checklist)
- [ ] Issue updated (comment or close with a pointer)

## Out of scope reminders

- Planned work lives in `docs/PLAN.md` and the issue backlog — do not start tickets not assigned/picked.
- No product features in scaffold PRs; no database/migrations yet; no deployment config.

## Agent skills

### Issue tracker

Issues live in GitHub Issues, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage labels used verbatim. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.
