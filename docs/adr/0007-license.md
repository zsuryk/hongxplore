# ADR-0007: License

- **Status:** proposed  ← OPEN — decide before the repo flips public (issue #17)
- **Date:** 2026-09-27

## Context

The repository starts private and flips **public on demo day**. An unlicensed public repo defaults to "all rights reserved", which is almost certainly not the intent for a student project, but the choice (MIT, Apache-2.0, GPL, or stay closed) has team and academic implications.

## Decision

*Open.* Tracked by **issue #17** ("License decision + flip-to-public checklist"). Must be resolved — LICENSE file added, this ADR updated to `accepted` — before the public flip.

## Consequences

- Until accepted: no LICENSE file exists; the "Before making the repo public" checklist in `CONTRIBUTING.md` blocks the flip until this closes.
- Choosing a permissive license (MIT/Apache-2.0) invites reuse; copyleft (GPL) constrains derivatives; "no license" keeps it source-visible but legally closed.
