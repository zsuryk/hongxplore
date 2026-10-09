# ADR-0010: Price and freshness are three-state and both optional

- **Status:** proposed (awaits kORNkin's data ack per docs/PLAN.md A8.3)
- **Date:** 2026-10-09

## Context

"Is this free?" and "is this listing still current?" are the two facts that decide whether a card is worth keeping, and the Activity contract carried neither (issue #50). District already existed on `Location`, so the gap was cost and freshness only.

Two failure modes pull in opposite directions. An Activity whose source says nothing about cost is not a free Activity — rendering it as "Free" invents a fact the user plans around. And the seed dataset, LCSD tariffs and NGO listings all publish cost inconsistently, so any required field would force a guess somewhere. The same applies to freshness: a listing with no publication date has not been confirmed, and inventing a date hides that.

Recurrence (a weekly badminton session) was explicitly out of scope — no repeat semantics are modelled yet.

## Decision

**Both fields are optional on `Activity`, defaulting to absent.** `price: Price | None` and `listed_at: UtcDateTime | None`.

**`Price` is a flat object with three reachable states, not two fields.** Absent `price` means the source published no pricing. A present `price` must say one of:

- free of charge — `is_free=true`, `amount` null
- priced — `amount` greater than zero, `currency` (ISO 4217, default HKD)

A `Price` that carries neither an amount nor `is_free` is rejected, so "present but undecided" cannot reach a client. `amount=0` is rejected rather than treated as free: a zero figure from a source is a data error, and free is already spelled unambiguously.

**`amount` is a `Decimal`.** Published fees carry cents (`HKD 27–54 / 30 mins`), and a float would quietly round a money figure at the boundary where the contract is supposed to be exact. It serialises to JSON as a string (`"59.00"`), which the generated web type reflects.

**`listed_at` reuses `UtcDateTime`**, so the repo-wide store-UTC / display-HKT rule applies with no new code: an offset-bearing input is normalised on validation, a naive one is rejected.

## Consequences

- Every existing seed entry and search result stays valid without edits, and #51 backfills real values where a source publishes them. Entries that cannot be sourced stay absent rather than guessed.
- The generated client sees `amount` as a string; the web card formats it. Absent is `price` missing, not `price.amount` missing — a renderer that treats "no amount" as "free" reintroduces the bug this shape exists to prevent.
- A priced entry carries no unit (per hour, per session, per day). LCSD tariffs are published per hour or per session, so the unit has to live in the source page for now; if that proves unusable for the card, a unit field is a follow-up change through A4, not a re-shape.
- Free entries serialise with a defaulted `currency` they have no amount for. Harmless as long as clients branch on `is_free`, which the field description states explicitly.
- Both consumers (#51 data, #52 card) are downstream of this shape; a mismatch is a PR, not a decision.