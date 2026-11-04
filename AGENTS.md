# AGENTS.md

## Purpose

Single source of truth for every human and AI agent working on this repo. `GEMINI.md` only points here; never duplicate rules elsewhere.

## Repo map

| Folder | Purpose | Owner |
| --- | --- | --- |
| `api/` | FastAPI backend: routes, models, config, services, prompts, tests | zsuryk (services/prompts: kORNkin; `api/tests/prompts/`, `api/tests/services/`: kORNkin) |
| `web/` | React + Vite frontend | sweetpinejam |
| `data/` | Seed datasets (JSON) | kORNkin |
| `docs/` | Project docs, ADRs (`docs/adr/`), skill config (`docs/agents/`) | zsuryk |
| `.github/` | CI workflows, templates | zsuryk |
| Root docs | `README.md`, `AGENTS.md`, `CONTEXT.md`, `docs/PLAN.md` | zsuryk |

The ownership matrix lives in **`docs/PLAN.md` → "Part B — Workstreams & ownership"**; use it to coordinate with the owner before changing another area.

## Hard rules

- **Never push to `main`.** Feature branch + PR only; never force-push shared branches. Prefer opening the PR as a **draft first**, then working in commits on it.
- **Never commit `.env` or secrets.** Only `.env.example` with placeholders.
- **Never commit live deployment identifiers** — the demo site URL, custom domain, cloud project number, revision names or provider keys. The deployed hackathon site is out of scope for this repository; use placeholders, or resolve the URL from `gcloud` at runtime.
- **The product PRD is out-of-repo.** Do not create `PRD.md`, `docs/PRD*`, or any PRD-style file. Do not create `CLAUDE.md` — nobody on this team uses Claude Code.
- **Do not copy the old static demo** (the `index.html` whiteboard from `kulturecanvas`) into this repo.
- **Timezone: Asia/Hong_Kong** — store UTC, display HKT.
- **All user-facing strings go in `web/src/copy.ts`** (English v1) — never inline in components.
- **No new dependencies** without noting them in the PR body.
- **Respect `DEMO_MODE`** in any future agent endpoint.
- Anything **>~1 hour or crossing two areas requires an issue first** (see `docs/agents/issue-tracker.md`).
- **Before touching a folder you don't own**, read the ownership matrix in `docs/PLAN.md` and coordinate with the owner in the issue before starting.
- **Test placement rule:** a test lives under the zone root of the module it covers — `api/tests/prompts/` and `api/tests/services/` belong to kORNkin; everything else under `api/tests/` stays zsuryk's. Adding a test for another area's module needs no second approval.
- **Ticket-first protocol (applies to EVERY agent — OpenCode, Codex, Antigravity — not only users of Matt's skills):** before writing code for a ticket, run `gh issue view <n> --comments` and read its acceptance criteria, `Blocked by` edges, and linked artifacts. The issue, not a chat log, is where work context lives.
- **Contract hub:** issue #4 is the single source of truth for API / service-seam / web-type questions. Its linked artifacts — `docs/openapi.json`, `docs/examples/agent-response.json`, `web/src/api/schema.ts` (via `pnpm gen:types`), and `api/app/services/ports.py` (once created) — are binding. If chat and these files disagree, the files win; fixing a mismatch is a PR, not a decision.

## Commands to run before saying "done"

```bash
cd api && uv run ruff format . && uv run ruff check . && uv run mypy app && uv run pytest -x
cd web && pnpm lint && pnpm typecheck && pnpm test && pnpm build
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

### Before any visual change to the UI

**Read `DESIGN.md` first, every time.** It is the design contract: tokens, card anatomy and the
content-driven height rule, board/zoom geometry, component behaviour contracts, motion rules and
the accessibility gates. A visual change that contradicts it is a bug in the change, not an
excuse to edit the document — if a decision genuinely has to change, change `DESIGN.md` in the same
commit and say why.

Specifically:

- **Never hand-write a colour, radius, duration or spacing value.** They go in
  `web/src/styles/tokens.css`, and `web/src/designSystem.test.ts` fails the build otherwise — in
  CSS *and* in component source.
- **Never weaken `designSystem.test.ts` to make a change pass.** It recomputes every WCAG contrast
  pair from the token layer, which is what stops a palette change shipping an unreadable UI. If an
  assertion is genuinely obsolete, change it deliberately, in the open, with the reason in the
  commit.
- **Run `impeccable detect` over changed UI targets** before calling a visual task done. The
  `impeccable` skill is **not installed for everyone** — if `impeccable` is not on your PATH,
  skip that step rather than installing it uninvited, and say in the PR body that you did. The
  design gates above are enforced by `designSystem.test.ts` in CI regardless of who runs them, so
  a missing detector never means an unenforced rule.
- **A design decision that is not written down has not been made.** Where a future change would
  find it — `DESIGN.md`, a code comment carrying the *why*, or both.

`PRODUCT.md` does not exist and must not be created: ADR-0004 keeps PRD-shaped artefacts
(personas, success metrics, roadmap tables) out of this repo. Product intent lives outside it.
`CONTEXT.md` plus the issues carry the domain vocabulary.

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
- **Project board:** every issue is a card on the "Hongxplore" project (https://github.com/users/zsuryk/projects/1) — statuses `Backlog` · `Todo` · `In Progress` · `Done` · `Cancelled`; move your own cards (`gh` commands: `docs/agents/issue-tracker.md`). Status transitions: agents set only event-derived values (claim → In Progress, merged → Done, reopened → Todo); `Backlog` ↔ `Todo` and `Cancelled` stay human — details in the same file. Auto-add is a native UI workflow (board → Settings → Workflows → Auto-add → this repo) that only a human can enable.
- Agent sessions map to a single PR; a human reviews the full diff, not just the agent's summary.
- Log non-obvious decisions as a new ADR in `docs/adr/` (append, never rewrite history).

## Team & roles

| GitHub handle | Role |
| --- | --- |
| `zsuryk` | Backend / API lead, repo admin, docs owner |
| `kORNkin` | Data & AI integration (Tavily, LLM prompts), prompt engineering |
| `sweetpinejam` | Frontend |

If you are not the owner of a folder, ping the owner in the PR before changing it.

## Before finishing a task

- [ ] Commands above are green (format, lint, typecheck, tests, build)
- [ ] Self-reviewed the full diff for secrets / debug prints / stray files
- [ ] PR body filled in (what/why, checklist)
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
