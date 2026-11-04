# ADR-0008: Required status checks must be approval-aware

- **Status:** superseded by [ADR-0012](0012-retire-zone-guard.md)
- **Date:** 2026-10-03

## Context

The `zone-guard` check is a required status check, which means GitHub evaluates it whenever the branch state it depends on changes. It depended on PR approvals, but approvals arrive through review submissions — and the original wiring published the check from two copy-pasted workflows with the same job name: one evaluated on `pull_request` (reading base/head/author from the event payload), the other on review/issue_comment events (resolving them via the API). The push-time copy evaluated before any approvals existed and stayed red; nothing re-triggered it when approvals landed, so a PR could look fully approved and still report `BLOCKED`, with no annotation.

## Decision

One workflow (`.github/workflows/zone-guard.yml`), one job (`zone-guard`), one check-run name, three triggers (`pull_request`, `pull_request_review` submitted/dismissed, `issue_comment` created). All three triggers resolve the PR's base SHA, head SHA, and author through one shared step (`gh api repos/.../pulls/N`), so every evaluation computes the same inputs regardless of what fired it. A single concurrency group with `cancel-in-progress: true` means the newest evaluation wins. A static, offline lint (`.github/scripts/check_unique_check_names.py`) fails any PR that reintroduces a second job publishing an already-used check-run name.

## Consequences

- The last zone-owner approval turns the check green on its own — no rerun, no empty commit, one row in the checks list.
- At the time, the branch ruleset still named `zone-guard`; because the check name did not move, no ruleset edit was needed.
- A same-zone PR still passes with zero approvals (verified explicitly; this is why the review-triggered run can never become the only required context).
- If a gate gets genuinely stuck (e.g. API trouble failing closed), the documented escape was a manual CI rerun from the Actions tab.
