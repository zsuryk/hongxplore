# ADR-0007: License

- **Status:** accepted
- **Date:** 2026-09-27
- **Decided:** 2026-11-03

## Context

The repository starts private and flips **public on demo day**. An unlicensed public repo defaults to "all rights reserved", which is almost certainly not the intent for a student project, but the choice (MIT, Apache-2.0, GPL, or stay closed) has team and academic implications.

The team agreed to open-source the repository, so the remaining decision was which permissive license to use.

## Decision

Use the **MIT License**.

- `LICENSE` lives at the repository root.
- The copyright line is `Copyright (c) 2026 Hongxplore contributors`, so contributions are attributed to the project rather than to an individual.
- This ADR is `accepted`, closing issue #17.

MIT is the smallest license that grants reuse, modification and redistribution while keeping the project compatible with the widest range of downstream uses. It matches the project's status as a student/hackathon project, and it avoids the copyleft obligations of GPL and the patent-grant machinery of Apache-2.0 that this project does not need.

## Consequences

- The source code and original documentation in this repository are MIT-licensed. Anyone may reuse them with attribution and without warranty.
- Contributions are accepted under the same MIT terms.
- Third-party material keeps its own terms: linked activity listings, venue data, cover images and other external sources are **not** relicensed by this repository, and their original licences/usage terms still apply.
- The public-flip checklist is the gate for the actual visibility change; the flip itself remains a manual owner action.
