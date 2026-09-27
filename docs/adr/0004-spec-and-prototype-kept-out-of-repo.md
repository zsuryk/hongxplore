# ADR-0004: Spec and static prototype kept out of this repo

- **Status:** accepted
- **Date:** 2026-09-27

## Context

The product PRD is zsuryk's personal work, and an earlier static prototype (`index.html` whiteboard) exists in the separate, older `kulturecanvas` project. Both were candidates for landing in this repo during bootstrap.

## Decision

- **No PRD files in this repo**: no `PRD.md`, no `docs/PRD*`, no PRD-style artefacts (personas, success-metrics tables, phased roadmap tables). The README carries a modest product background only; the product spec lives outside this repository.
- **Do not copy the static demo.** The old `index.html` prototype is referenced in the README as a historical artefact of `kulturecanvas` and nothing more.
- No `CLAUDE.md` (no one on the team uses Claude Code) and no `docs/DECISIONS.md` (decisions live in `docs/adr/`).

## Consequences

- Repo docs stay engineering-facing; `AGENTS.md` + `docs/PLAN.md` + issues are the work context.
- The engineering skills bind to `AGENTS.md` (no `CLAUDE.md` to hijack them) and to `docs/adr/` as the decision log.
- Demo-day repo scrubbing (CONTRIBUTING checklist) has no PRD or prototype to remove.
