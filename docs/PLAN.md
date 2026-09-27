# Hongxplore plan

Two parts: **Part A — Tickets** (the phased backlog; mirrors GitHub issues #1–#16) and **Part B — Workstreams & ownership** (the binding role-separation rules). Where this file and an issue disagree, the issue wins — update this file in the same PR.

---

## Part A — Tickets

### Phase 0 — Scaffold (issue #1, this PR)

Completed by PR #1:

- [x] Folder structure incl. Matt's-skills layout (`CONTEXT.md`, `docs/adr/`, `docs/agents/`, `## Agent skills` in `AGENTS.md`)
- [x] All docs: README, AGENTS.md, GEMINI.md, CONTRIBUTING.md, ARCHITECTURE.md, this plan, ADR-0001…0007
- [x] Runnable-but-empty skeleton: `GET /health` on :8000, hello page on :5173, lockfiles committed
- [x] Tooling green: uv + ruff + mypy + pytest; pnpm + eslint + prettier + tsc
- [x] CI: `api`, `web`, `commitlint`, `zone-guard` jobs; CODEOWNERS; templates
- [x] Contract pipeline proven: `docs/openapi.json`, `docs/examples/agent-response.json`, `web/src/api/schema.ts` via `pnpm gen:types`
- [x] Tracker: labels, project board, issues #1–#16 with blocking edges

### Ticket index

| #  | Title                                                            | Labels                                          | Owner          | Depends on        | Blocks      |
| -- | ---------------------------------------------------------------- | ----------------------------------------------- | -------------- | ----------------- | ----------- |
| 1  | Bootstrap repo scaffold (docs, skeleton, CI, tracker)            | type:chore, area:infra, priority:p0             | Kyrus          | —                 | —           |
| 2  | Settings & env validation layer for api (fail-fast, typed)       | type:feature, area:api, priority:p0             | Kyrus          | —                 | 3, 4, 5, 8  |
| 3  | Define canonical Activity schema (Pydantic) + OpenAPI contract   | type:feature, area:api, priority:p0             | Kyrus          | 2                 | 8, 13       |
| 4  | OpenAI-compatible LLM client wrapper (base URL/model from env)   | type:feature, area:api, priority:p1             | Korn           | 2                 | 8           |
| 5  | Tavily search service + query-result cache design & implementation | type:feature, area:data, priority:p1          | Korn           | 2                 | 8 (live)    |
| 6  | Seed dataset: 100–150 real HK activities (JSON, bilingual, sourced) | type:feature, area:data, priority:p1          | Korn           | —                 | 8           |
| 7  | Prompt engineering: intent parsing & match-rationale prompts     | type:feature, area:data, priority:p1            | Korn           | 4                 | 8           |
| 8  | POST /api/agent happy path with DEMO_MODE seed fallback          | type:feature, area:api, priority:p1             | Kyrus + Korn   | 2, 3, 4, 6, 7 (+5 live) | 12, 15 |
| 9  | Web: infinite canvas viewport (pan, zoom, fit, grid)             | type:feature, area:web, priority:p1             | Pax            | —                 | 11          |
| 10 | Web: event card component (anatomy, spawn/discard animations)    | type:feature, area:web, priority:p1             | Pax            | —                 | 11, 14      |
| 11 | Web: card drag + timeline slot docking                           | type:feature, area:web, priority:p2             | Pax            | 9, 10, 13         | 15          |
| 12 | Web: search bar + agent status panel wired to /api/agent         | type:feature, area:web, priority:p2             | Pax            | 8 (UI shell earlier) | 15      |
| 13 | Web: Zustand store + generated API client wiring (fixture-driven until #8) | type:feature, area:web, priority:p2   | Pax            | 3                 | 11          |
| 14 | Web: discard bin + "find similar" interactions                   | type:feature, area:web, priority:p2             | Pax            | 10                | —           |
| 15 | End-to-end DEMO_MODE pitch path (seed → cards → timeline)        | type:feature, area:api, area:web, priority:p1   | Kyrus + Pax    | 8, 11, 12         | —           |
| 16 | License decision + flip-to-public checklist                      | type:chore, area:infra, priority:p2             | Kyrus          | —                 | —           |

All tickets are labelled `ready-for-agent` (fully specified below). **No one starts a ticket whose blockers are open** — take an unblocked ticket from your own zone meanwhile (Part B, A2).

---

### #1 — Bootstrap repo scaffold (docs, skeleton, CI, tracker)

**Area:** infra · **Owner:** Kyrus · **Depends on:** — · **Blocks:** —

Scope: everything in Phase 0 above — folder structure, docs, runnable-empty skeleton, CI, tracker. Tracked by this PR (`Closes #1`).

Acceptance criteria: see the Phase 0 checklist and issue #1.

---

### #2 — Settings & env validation layer for api (fail-fast, typed)

**Area:** api · **Owner:** Kyrus · **Depends on:** — · **Blocks:** 3, 4, 5, 8

Scope: turn `api/app/config.py` into a real settings layer: a pydantic-settings `Settings` class covering `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `TAVILY_API_KEY`, `DEMO_MODE`. Values load from `api/.env` + process env, are typed, and fail fast with a clear error at startup rather than at first use. This is the base every other api/data ticket builds on.

- [ ] `Settings` exposes typed fields: `OPENAI_API_KEY`, `OPENAI_BASE_URL` (optional), `OPENAI_MODEL`, `TAVILY_API_KEY`, `DEMO_MODE: bool = True`
- [ ] Malformed values (e.g. non-boolean `DEMO_MODE`) raise a clear error at startup
- [ ] pytest covers defaults, `.env` overrides, and invalid-value failure
- [ ] `.env.example` documents every key with comments; no secrets committed
- [ ] `ruff` / `mypy` / `pytest` green

---

### #3 — Define canonical Activity schema (Pydantic) + OpenAPI contract (CONTRACT HUB)

**Area:** api · **Owner:** Kyrus · **Depends on:** #2 · **Blocks:** 8, 13

Scope: the only cross-zone artifact. Define the Pydantic models in `api/app/models/` — `Activity` (title, `lang`, `tags`, `parts` = time slots, `source`, location, url, image, plus match rationale on responses) and the `POST /api/agent` request/response envelopes. Regenerate `docs/openapi.json`, seed `docs/examples/agent-response.json`, and draft the service seam `api/app/services/ports.py` (`Protocol` interfaces: `SearchProvider`, `LLMClient`, `ActivityCache`). Contract freeze requires Korn's data ack (Part B, A8.3).

Acceptance criteria — **this issue is the contract hub**; downstream tickets #5, #8, #12, #13 link back here:

- [ ] Pydantic models define `Activity` + agent request/response; **Korn comments his data ack** on `lang`, `tags`, `parts`, `source` before freeze
- [ ] `cd api && uv run python scripts/dump_openapi.py` → **no git diff** on `docs/openapi.json`
- [ ] `cd web && pnpm gen:types` → **no git diff** on `web/src/api/schema.ts`
- [ ] `docs/examples/agent-response.json` validates against the schema; pytest asserts against this fixture
- [ ] Draft `api/app/services/ports.py` with the three Protocol interfaces committed (or, if not yet created, this issue carries the exact draft that lands with the PR)

---

### #4 — OpenAI-compatible LLM client wrapper (base URL/model from env)

**Area:** api · **Owner:** Korn · **Depends on:** #2 · **Blocks:** 8

Scope: a thin client in `api/app/services/llm/` over the official `openai` SDK, configured purely from `config.py` (ADR-0002): key/base URL/model from env, any OpenAI-compatible endpoint must work. Implements the `LLMClient` port from #3's seam. No vendor assumptions in code, tests, or docs.

- [ ] Client built only from `Settings` — no hardcoded model or vendor
- [ ] Implements the `LLMClient` port (draft from #3)
- [ ] Timeouts/retries come from Kyrus-owned config keys, not magic numbers (Part B, A8.4)
- [ ] Unit tests use mocked transport — no live calls, nothing needed in CI
- [ ] `ruff` / `mypy` / `pytest` green

---

### #5 — Tavily search service + query-result cache design & implementation

**Area:** data · **Owner:** Korn · **Depends on:** #2 · **Blocks:** 8 (live-search path)

Scope: `api/app/services/search/` — a Tavily client (httpx) behind the `SearchProvider` port, a query normaliser producing cache keys, and a query-result cache behind the `ActivityCache` port with TTL semantics (ADR-0003). Storage engine per ADR-0005 when accepted; interim storage must sit behind the port so the engine swap is a non-event. `DEMO_MODE=true` never touches the network.

- [ ] `SearchProvider` implemented; results cached by normalised query with configurable TTL (TTL is a Kyrus-owned config key)
- [ ] Same query twice → exactly one upstream call (test with mocked Tavily)
- [ ] `DEMO_MODE=true` path makes zero network calls
- [ ] Storage sits behind the `ActivityCache` port (engine per ADR-0005)
- [ ] No `TAVILY_API_KEY` needed in CI

---

### #6 — Seed dataset: 100–150 real HK activities (JSON, bilingual, sourced)

**Area:** data · **Owner:** Korn · **Depends on:** — · **Blocks:** 8

Scope: `data/` — 100–150 real Hong Kong activities (events, grassroots recreation, NGO cultural events, bookable facilities) as JSON. Bilingual: Cantonese original plus English translation, each with source URL, time info, district, tags. This is what `DEMO_MODE` serves, so it must look real.

- [ ] 100–150 entries, all real and sourced (URL per entry)
- [ ] Bilingual: Cantonese source text + English translation
- [ ] Time/date, district, tags present on every entry
- [ ] Validates against the `Activity` schema from #3 (regenerate/validate once #3 merges)
- [ ] Attribution/licensing note for sources

---

### #7 — Prompt engineering: intent parsing & match-rationale prompts

**Area:** data · **Owner:** Korn · **Depends on:** #4 · **Blocks:** 8

Scope: versioned prompt templates in `api/app/prompts/` — intent parsing (natural language + time chips → structured search query) and match rationale (Activity + query → short "why this matches"). Output contracts must conform to #3's models. Testable offline: rendering and parsing are unit-tested without any LLM call.

- [ ] Templates for intent parsing and match rationale live in `api/app/prompts/`
- [ ] Structured outputs conform to #3's request/response models
- [ ] Offline tests assert templates render with sample inputs (no LLM call, no keys)
- [ ] 5 sample queries with expected parses captured as fixtures
- [ ] `ruff` / `mypy` / `pytest` green

---

### #8 — POST /api/agent happy path with DEMO_MODE seed fallback

**Area:** api · **Owner:** Kyrus + Korn · **Depends on:** #2, #3, #4, #6, #7 (live-search path also #5) · **Blocks:** 12, 15

Scope: the route in `api/app/routes/` plus wiring (Kyrus) and the orchestration inside `services/` (Korn) — split authorship per Part B, A8.2. Happy path: parse intent → search (or seed) → normalise → rank → translate → respond with cards + match rationale + agent log, in the contract shape. `DEMO_MODE=true` serves `data/` seed JSON with zero network.

- [ ] `POST /api/agent` returns the contract shape (`docs/examples/agent-response.json`)
- [ ] `DEMO_MODE=true` serves seed data; zero network calls
- [ ] Route depends only on the ports in `services/ports.py` — no concrete service imports
- [ ] Contract regen produces no diff (or fixture + snapshot + types updated together)
- [ ] pytest covers the mocked live path and the `DEMO_MODE` path

---

### #9 — Web: infinite canvas viewport (pan, zoom, fit, grid)

**Area:** web · **Owner:** Pax · **Depends on:** — · **Blocks:** 11

Scope: the custom DOM transform layer for the whiteboard — one viewport module owning pan/zoom/fit math (screen ↔ world coordinates), a scaling grid, clamped zoom range. No per-card positioning hacks; cards live in world coordinates and inherit the viewport transform.

- [ ] Pan by dragging the background; zoom by wheel/pinch within clamped limits; fit-to-content
- [ ] Grid renders and scales with zoom
- [ ] All transform math in one viewport module; coordinate-transform unit tests
- [ ] `pnpm lint && pnpm typecheck && pnpm build` green

---

### #10 — Web: event card component (anatomy, spawn/discard animations)

**Area:** web · **Owner:** Pax · **Depends on:** — · **Blocks:** 11, 14

Scope: the Activity card as a React component — anatomy: title, time, location, source/lang badge, match rationale. Spawn animation when the agent returns it; discard animation when rejected. Fixture-driven (renders from `docs/examples/agent-response.json` shapes) so it never waits on the API.

- [ ] Card renders all anatomy fields from the fixture
- [ ] Spawn and discard animations present and performant
- [ ] Every string comes from `web/src/copy.ts`
- [ ] Render unit test; lint/typecheck/build green

---

### #11 — Web: card drag + timeline slot docking

**Area:** web · **Owner:** Pax · **Depends on:** #9, #10, #13 · **Blocks:** 15

Scope: drag cards across the canvas and dock them onto free timeline slots; snapping on valid drop, return on invalid drop; docked cards reflow with the timeline. Discarded/rejected cards are separate (see #14).

- [ ] Drag from canvas; drop on a timeline slot docks with snap, drop elsewhere returns to origin
- [ ] Docked card follows its slot on resize; docking rules documented in code
- [ ] Smooth with ~30 cards; drag-cancel works
- [ ] Store tests cover dock state transitions

---

### #12 — Web: search bar + agent status panel wired to /api/agent

**Area:** web · **Owner:** Pax · **Depends on:** #8 (the UI shell may start earlier) · **Blocks:** 15

Scope: search input + time-slot chips that submit to `POST /api/agent`, plus a status panel showing agent state (thinking/searching/results) and the agent log. Error states get friendly copy. Shell is buildable against fixtures from day one; wiring lands after #8.

- [ ] Search input + time-slot chips submit to `POST /api/agent`
- [ ] Status panel reflects loading/searching/results and shows the agent log
- [ ] Error path renders friendly copy from `copy.ts`
- [ ] Integration test against the fixture (mocked fetch); lint/typecheck/build green

---

### #13 — Web: Zustand store + generated API client wiring (fixture-driven until #8)

**Area:** web · **Owner:** Pax · **Depends on:** #3 · **Blocks:** 11

Scope: one Zustand store for cards, viewport, timeline, and agent log, plus the API client generated from `web/src/api/schema.ts` (`pnpm gen:types` — never hand-edit). Until #8 ships, the client is driven by the shared fixture `docs/examples/agent-response.json`; switching to the live API is a wiring change, not a rewrite.

- [ ] Store covers cards, viewport, timeline, agent log with typed actions
- [ ] API types generated from `docs/openapi.json` via `pnpm gen:types`
- [ ] Fixture-driven responses until #8; single switch point to the live client
- [ ] No `any` types; lint/typecheck/build green

---

### #14 — Web: discard bin + "find similar" interactions

**Area:** web · **Owner:** Pax · **Depends on:** #10 · **Blocks:** —

Scope: drag a card to the discard bin to reject it (removes it from the board, recoverable per store semantics), and a "find similar" card action that re-queries the agent seeded from that card (live call after #8; fixture-driven before).

- [ ] Drag to discard bin removes the card from the board with its animation
- [ ] "Find similar" issues an agent query seeded from the card
- [ ] Empty-state and confirmation copy lives in `copy.ts`
- [ ] Store tests cover both flows

---

### #15 — End-to-end DEMO_MODE pitch path (seed → cards → timeline)

**Area:** api + web · **Owner:** Kyrus + Pax · **Depends on:** #8, #11, #12 · **Blocks:** —

Scope: glue the whole demo: fresh clone → `.env` with `DEMO_MODE=true` → query → seed cards → drag onto weekend timeline. Zero network, zero keys. This is the pitch path; integration/merge responsibility sits with Kyrus (Part B, A6).

- [ ] Fresh clone + `DEMO_MODE=true` completes seed → cards → timeline with no network
- [ ] api pytest covers the demo path; web smoke covers the flow
- [ ] Dates display in HKT; no secrets required anywhere
- [ ] Joint Kyrus + Pax pass recorded as a comment on this issue

---

### #16 — License decision + flip-to-public checklist

**Area:** infra · **Owner:** Kyrus · **Depends on:** — · **Blocks:** —

Scope: resolve ADR-0007 (status `proposed` → `accepted`), add the LICENSE file, and execute the "Before making the repo public" checklist in `CONTRIBUTING.md` before the demo-day flip.

- [ ] ADR-0007 flipped to accepted with the chosen license
- [ ] `LICENSE` file added at the repo root
- [ ] `CONTRIBUTING.md` public-flip checklist executed and ticked
- [ ] GitHub Actions secrets confirmed empty; git history scrubbed for secrets

---

## Part B — Workstreams & ownership

Binding role-separation rules. These make it structurally hard for Kyrus, Korn, and Pax to collide. Read this before touching any file outside your zone.

### A1. Ownership matrix (binding, mirrors CODEOWNERS)

| Zone | Owner | Files | Everyone else |
| --- | --- | --- | --- |
| API surface | Kyrus | `api/app/routes/`, `api/app/models/`, `api/app/config.py`, `api/tests/`, `.github/`, root docs (`README`, `AGENTS.md`, `CONTRIBUTING.md`, `docs/PLAN.md`, `docs/adr/`) | open an issue / PR; `zone-guard` enforces the owner's approval |
| AI & data | Korn | `api/app/services/`, `api/app/prompts/`, `data/` (seed JSON) | no edits without Korn's ack on the issue |
| Frontend | Pax | `web/**` | no edits without Pax's ack on the issue |
| Shared contract | Kyrus defines in #3; **owned jointly after freeze** | `api/app/models/` Activity + generated web types | changes require an issue comment + ack from Kyrus AND the affected consumer |

`.github/CODEOWNERS` is the machine-readable copy; `zone-guard` CI enforces it per path.

### A2. Dependency edges

Every ticket carries `Depends on` / `Blocks` — the exact edges are in the Part A index and in each issue's `**Blocked by:**` line (native GitHub dependency edges where available). **No one starts a ticket whose blockers are open.** If you need work in the meantime, take an unblocked ticket from your own zone.

### A3. Day-one sequencing (all three busy in parallel from hour one, zero shared files)

- **Kyrus:** #1 (this PR) → #2 → #3 (contract freeze) → #8 route stub
- **Korn:** #6 seed dataset (no code deps) → #4 → #7 → #5 (works only inside `services/` + `data/`, behind interfaces; never touches `routes/`) → joins #8
- **Pax:** #9 → #10 → #13 (fixture-driven; generate types from #3's OpenAPI output the moment it merges) → #11; #12 UI shell early, wiring lands after #8

### A4. Contract-first rule

The Activity schema + OpenAPI contract (#3) is the **only** cross-zone artifact; it is priority p0 and lands early. After freeze, contract changes require an issue comment announcing the change and acks from both consumers before any PR — **nobody re-shapes the contract inside a feature PR.**

### A5. Consumer-independent rule

Web never blocks on a live API (fixtures / `DEMO_MODE` first); services never block on web. This is what keeps #9/#10/#13 startable on day one.

### A6. Conflict rules

- Two owners never edit the same file concurrently.
- A PR crossing a zone boundary requires the zone owner's approval — `zone-guard` enforces it. **Coordinate in the issue before starting, not in the PR after.**
- Integration/merge responsibility for cross-zone tickets (#8, #15) sits with Kyrus.

### A7. Checkpoints

1. Within 15 minutes of #3 merging: all three re-sync to confirm the contract is usable (async comment on #3 is fine).
2. Joint pass on #15 before the demo freeze.
3. Standup = each owner moves only their own cards; the board must reflect reality daily.

### A8. Seam rules — the four gray-zone agreements (explicit and binding)

The Kyrus↔Korn seam is materialized as **`api/app/services/ports.py`** — `Protocol` interfaces (`SearchProvider`, `LLMClient`, `ActivityCache`) drafted by Kyrus alongside #3 and implemented by Korn — plus the contract artifacts (`docs/openapi.json`, `docs/examples/agent-response.json`, `web/src/api/schema.ts`). Interface changes follow the A4 contract protocol. The four rules:

1. **Thin-plumbing tickets (#4 LLM client, #5 Tavily/cache) live in Korn's zone but build on Kyrus's base.** Korn writes `services/` code only on top of `config.py` from #2 (which is why #4 and #5 are `Blocked by: #2`). He does not edit `config.py`, `routes/`, or `models/` — a new config key is requested in the issue and added by Kyrus.
2. **#8 `/api/agent` is one PR with split authorship, never two writers in one PR.** Kyrus writes the route + wiring against the port interface (a stub implementation exists from day 1, so the route never blocks); Korn writes the orchestration inside `services/`. Kyrus authors and merges; Korn co-reviews. If the split stalls, the route stays stubbed and the service lands as its own PR — the integration happens at the port, not in a shared file.
3. **#3 schema freeze requires Korn's data ack.** Kyrus owns the Activity schema, but before freeze Korn must comment his ack (or objections) on the fields that drive search and ranking: `lang`, `tags`, `parts` (time slots), `source`. No ack = no freeze. After freeze, changes go through A4 (issue comment + acks from Kyrus and every consumer before any PR).
4. **Cross-cutting policy vs in-service behavior.** Retries, timeouts, concurrency, logging format, and HTTP error mapping are **Kyrus's**, defaulted in `config.py`/middleware; strategy *inside* a service (search approach, prompt sequencing, cache TTL semantics, ranking weights) is **Korn's**. When Korn needs a new policy value, it becomes a config key owned by Kyrus — never a hard-coded constant in `services/`.
