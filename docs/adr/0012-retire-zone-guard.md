# ADR-0012: Retire the zone-guard gate

- **Status:** accepted
- **Date:** 2026-11-04

## Context

The `zone-guard` CI check enforced per-path reviewer approval through `.github/CODEOWNERS`. It required a separate workflow, a Python script, a static ownership test and a bypass phrase, and it kept reporting a review state that the team no longer wanted as a merge gate. The rebalanced backlog had already moved work outside the original zone split.

## Decision

Remove the gate and its supporting machinery:

- `.github/workflows/zone-guard.yml`
- `.github/scripts/zone_guard.py`
- `.github/CODEOWNERS`
- `api/tests/test_zone_ownership.py`

The ownership matrix in `docs/PLAN.md` remains as coordination guidance, not a merge gate. ADR-0008 is superseded.

## Consequences

- PRs are no longer blocked or annotated by per-path ownership; GitHub's required approvals stay at 0.
- Cross-area work is coordinated in the issue, as described in `AGENTS.md` and `docs/PLAN.md`.
- There is no bypass phrase or ownership check to maintain.
