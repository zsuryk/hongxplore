# DESIGN.md — Hongxplore design system

The visual contract for the web app. It records **what the system is and why**, so the next
change does not re-litigate it. Code that contradicts this document is a bug in the code, not an
excuse to edit the document — if a decision genuinely needs to change, change it here first and
say why in the commit.

`web/src/styles/tokens.css` is the machine-readable form of everything in "Tokens" below.
`web/src/designSystem.test.ts` enforces it and runs on every build.

**This is a design-system document, not a product requirements document.** Per
[ADR-0004](docs/adr/0004-spec-and-prototype-kept-out-of-repo) there are no personas, no success
metrics and no roadmap here. Product intent lives outside this repo. What belongs here is the
smallest set of rules that makes the UI predictable.

---

## The direction: Departure Board

Hongxplore is an infinite whiteboard plus an agent that researches real activities in Hong Kong.
You ask in plain language, cards land on the board, and you drag the ones you want into a
weekend timeline.

The visual system is **the concourse split-flap board**: fixed cells, one type voice, ruled rows,
amber for anything waiting on you — applied to the agent's live output, while the canvas itself
stays plain so the board never becomes a costume.

Three ideas carry it:

1. **One rule does the separating.** Not shadows, not fill contrast — a single 1px `--rule`
   value, reused as the card bezel, the card header divider, the timeline cell divider, the
   empty-slot drop target and the toolbar separator. Each card is a hole in a continuous lattice.
2. **Amber means pending, and nothing else.** It is the agent-log running lamp, the replacement
   prompt, the warning. It is never a border, because twelve amber outlines read as an error state.
3. **The canvas is furniture.** Chrome recedes so the cards stay the subject.

### Why not the obvious alternative

Direction A ("Municipal Mosaic") was prototyped to the same level and rejected, and the reason is
worth keeping because it constrains future design work here:

- Its identity lived in the **board ground**, a 40px world-space pattern. At 40% zoom the 1px
  grout falls below one device pixel and the mosaic disappears entirely. Repairing it needed a
  third layer outside `.board__pan`, which **amends ADR-0009**, and gave up world-locking.
- Its `--card` porcelain leaked into the timeline, making the timeline the brightest object on
  screen and inverting the hierarchy the product wants.

Departure Board's identity lives in the **card**, which is visible at every zoom, and its chrome
recedes. If a future direction reintroduces a ground-level signature pattern, it must survive 40%
zoom without an ADR amendment.

---

## Tokens

`web/src/styles/tokens.css` is the only place a colour, radius, duration or spacing value may be
written. **Raw values in component CSS are bugs.** `designSystem.test.ts` fails the build when one
appears, so the rule needs no discipline to hold.

Tailwind is wired in as **theme + utilities, deliberately without preflight** — see
`web/src/index.css`. The `@theme inline` block only *projects* `tokens.css` into Tailwind's
namespace so `bg-card` and `text-muted-foreground` resolve to the same values. It is not a second
source of truth.

### Colour

Semantic roles, in the order components reach for them:

| Role | Value | Carries |
| --- | --- | --- |
| `--background` | `#0e0f11` | the canvas |
| `--foreground` | `#f2f2f0` | primary text |
| `--card` | `#26292d` | card and timeline-slot face |
| `--card-foreground` | `#f2f2f0` | card title, rationale |
| `--card-muted-foreground` | `#a6a9ae` | district, venue, freshness |
| `--muted` / `--muted-foreground` | `#17191c` / `#a6a9ae` | chrome surfaces |
| `--primary` / `--primary-foreground` | `#e8a317` / `#0e0f11` | amber — **pending only** |
| `--accent` / `--accent-foreground` | `#5a9de6` / `#0e0f11` | state: selection, recent, free-chip |
| `--destructive` | `#ec6a5e` | discard, destructive confirmation |
| `--rule` | `#6e747b` | **the** 1px structural rule |
| `--ring` | `#e8a317` | focus |
| `--popover` / `--input` | `#1a1c1f` / `#16181b` | floating surfaces |

One more role carries the amber theme without carrying its weight: `--surface-pending`, an 8%
amber wash used only by the research placeholder's face. `--primary-soft` is the saturated brown
the amber drop-targets and the "replace this slot" decision use; at card size it outshouts the
result cards it is only standing in for, so the placeholder gets a wash instead and keeps the
saturated version for the 2px drop-target edges where the contrast against the slot is the point.

Brand tokens: `--lamp-live #35b37e`, `--lamp-pending #e8a317`, `--lamp-cancelled #e0574a`,
`--success`, `--warning`.

Two families do different jobs and must not be merged:

- **Lamps** (`--lamp-*`) — a stage running, done, or failed.
- **Accent** (`--accent`) — a user-facing state on a surface.

#### The deliberate non-pair

**`--card` on `--background` is 1.31:1 and that is intentional.** Separation is carried entirely by
`--rule`, which measures 4.06:1 against the canvas. No dark fill can do better: the first one that
clears 3:1 is mid-grey `#626262`, at which point this stops being a dark board. `designSystem.test.ts`
asserts this pair stays *below* 3:1, so a well-meaning PR cannot "fix" it without updating this
document.

Decorative hairlines use `--divider` (28%) and may sit below 3:1. WCAG 1.4.11 governs **meaningful
UI boundaries**, so anything a user has to see to operate a control uses `--rule` instead.

### Typography

System font stacks only — no webfonts, no font downloads. CJK falls through `PingFang HK` /
`Noto Sans HK` / `Microsoft JhengHei`.

| Token | Size | Used for |
| --- | --- | --- |
| `--text-plate` | 21px | card serial, CJK title |
| `--text-title` | 17px | card title (Latin) |
| `--text-body` | 13.5px | match rationale |
| `--text-meta` | 11px | district, venue, freshness |
| `--text-label` | 10.5px | row labels, rank, slot labels |

**Bilingual type.** Card titles arrive in Traditional Chinese, English, or both. Tracking opens as
size closes (`--tracking-label: 0.1em` on 10.5px, `--tracking-title: 0.03em` on 17px), which keeps
small caps legible without going bold. The font stack carries a `--cjk-weight-bump` so CJK sits at
an optical weight matching the Latin beside it rather than looking thin.

### Spacing, radius, elevation

Spacing is a `--space-1` … `--space-10` scale. Radii are near-square (`--radius-xs` 2px →
`--radius-lg` 6px); only fully round things get `--radius-pill`. **Elevation is nearly flat** —
shadow answers "how far off the plane is this", never "what is this". `--shadow-drag` is the only
one with real presence.

### Motion

| Token | Duration | Used for |
| --- | --- | --- |
| `--motion-fast` | 90ms | lamp state change |
| `--motion-base` | 150ms | card seat, row update, zoom step |
| `--motion-slow` | 220ms | one agent-log cascade pass |

All motion is `opacity`, `transform` or `zoom` only, so the single
`prefers-reduced-motion` block in `tokens.css` collapses everything — including transitions added
later, without anyone having to remember to opt in.

**The cascade is reserved for the agent log.** It is the one place a sequential reveal is
information rather than decoration. **Banned:** glows, hover bloom, and any permanently animating
element. The old identity's infinite pulsing "recent search" border was removed for exactly this
reason — recency is now a static 2px `--accent` edge, which needs no reduced-motion special case.

---

## Board geometry and zoom

Per [ADR-0009](docs/adr/0009-canvas-zoom-with-css-zoom), unchanged by this redesign:

- `.board__pan` is **screen space** and carries the pan offset only.
- `.board__world` is **world space** and carries `zoom`, so the browser re-rasterises type at the
  new scale instead of stretching a bitmap.
- **Chrome renders outside `.board__pan`** — toolbar, timeline, discard bin, guide, empty state,
  toasts. Chrome never blurs or drifts under pan/zoom.
- World-space content must not use `vh`/`vw`; `zoom` multiplies those.

**Geometry is owned by `boardLayout.ts` in TypeScript** — card width, grid pitch, fit bounds — and
published to CSS as `--card-*` / `--board-*` custom properties. Those numbers are never written in
a stylesheet. CSS holds only defaults for the moment before the first injection.

The canvas is a lattice: a fine `--board-grid-size` grid plus major lines every 5 cells.

---

## Components

### App shell

The header is a three-column grid — brand, search, empty — so the search sits at the optical
centre at every width instead of drifting right behind the wordmark. The search is the product's
primary action; identity sits quietly to one side of it. Header and agent-status strip wear
`--background` and are closed off with a rule, so the **cards are the only filled objects on
screen** — that is what "the canvas is furniture" has to mean in practice.

### Activity card

Anatomy, in order: **header row** (`--text-plate` serial plate in mono, district as a tracked
caps label, then a sub-row of language chip and departure time) → **1px `--rule` divider** →
**title** (with the original CJK title beneath it when the title was translated) → **ruled data
rows** (`Venue` / `Price` / `Listed`, a fixed label gutter so every card's values align) →
**rationale** in a recessed cell → **footer** (source link + find similar).

The serial is the card's index in the **full** card list, not in the cards currently on the
canvas, so docking or discarding never renumbers the cards that remain. It is `aria-hidden`: a
row number the eye reads adds nothing to the card's accessible name.

The **content-driven height rule**: the card's height is set by its content, never by a
hard-coded value. Variants (`compact`, `wide`, `tall`) set a *minimum* via `--card-min-height`,
`--card-compact-min-height`, `--card-wide-min-height`, `--card-tall-min-height` — all injected by
`boardLayout.ts` — and grow past it. A title that wraps to three lines must push the card taller,
not clip or overflow. This is why `--card-min-height` is the one number written in two languages,
and why that coupling is commented in both.

The rationale is a **recessed `--muted` cell with a 1px `--rule` edge**, distinguished by
recession and by its tracked-caps label rather than by a coloured stripe: a 3px accent
`border-left` on every card would turn the board into a set of callout boxes and spend `--accent`
— the state colour — on something that is not a state. Cards carry **no resting shadow**; the
bezel already says where the card ends, and `--shadow-drag` is the only one with real presence.

The same component renders at two sizes — `size="canvas"` on the board and `size="docked"` in a
timeline slot — sharing one token set. The docked size drops the serial, the data rows and the
rationale and re-reads the card as a time, a title and a place.

### Iconography

Glyphs are **inline SVG authored in `src/icons.tsx`**, not an icon package and not a font. One
24-unit grid, one stroke weight (`--icon-stroke`), round caps, no fills — which is what makes a
16px glyph and a 24px glyph read as the same hand. They take their colour from `currentColor` and
their size from `--icon-size`, so no component restates either.

### Right-edge toolbar

An **icon rail**, `--rail-width` wide, holding zoom out / zoom in / fit / auto-tile / auto-fit /
clear board, separated by the `--rule`. It lives in screen space, never scales, and states the
current zoom in an `aria-live` region.

- The **text label is revealed on hover *and* on focus**, as an `aria-hidden` sibling element
  positioned outside the rail — never a `title` attribute, because a native tooltip is
  mouse-only, and never the accessible name, because every control keeps a real one in
  `aria-label`.
- The **zoom readout is the reset control**: the visible number is `aria-hidden` and a separate
  live region announces the long form, so a screen-reader user hears "Zoom: 80%", not a bare
  figure. Clicking the number resets.
- **Auto-fit is a switch**, the only two-state control in the rail, so it is the only one that
  carries a lamp.
- **Clear board is destructive** and keeps its danger variant so it cannot be misread as another
  zoom control.

### Weekend timeline

The plan surface, where docked cards are recorded. **It must become day-agnostic** — the available
days are going configurable, so nothing may bake Saturday, Sunday, two days, or six slots into the
visual language.

> **It is not yet.** `styles/timeline.css` currently hardcodes
> `grid-template-columns: repeat(3, minmax(0, 1fr))`, and `copy.ts` hardcodes the six
> Saturday/Sunday ids. The target is:
>
> ```
> --slot-count   data, never a CSS constant
> .timeline__slots  grid-template-columns: repeat(var(--slot-count), minmax(0, 1fr))
> day list         a loop over DayGroup[]
> ```
>
> Left to the ticket that makes days configurable (#69), which already owns this surface — this
> ticket documents the rule rather than doing the refactor, so the two do not collide.

Slot states are specified as **states, not sizes**, because they change shape with the day set:

| State | Treatment |
| --- | --- |
| empty | transparent fill, **1px dashed `--rule`**, slot label already visible |
| filled | `--card` fill, 1px solid `--rule` |
| drop target | 2px solid `--primary` outline, replacing `--rule` |
| mismatch | 2px solid `--destructive` outline + destructive label line |

**An empty slot shows its own label before anything is dragged into it.** The label is the
affordance — the user must be able to read "Saturday afternoon" before deciding — and the dashed
edge is what announces the slot as a boundary to assistive tech, not only to the eye.

> Known constraint: the day label sits in a fixed-width column and wraps at longer localised
> strings. Flagged, not fixed.

### Discard bin

A dashed `--rule` drop target in screen space. It is a drop target, so its boundary is meaningful
and must clear 3:1 — it is drawn with `--rule`, not `--divider`.

---

## Accessibility

These are gates, not aspirations. `designSystem.test.ts` enforces the numeric ones.

- **Contrast.** Body text ≥ 4.5:1; meaningful UI boundaries and focus indicators ≥ 3:1
  (WCAG 1.4.11). Both are recomputed from the token layer in the test suite, so changing a token
  without re-checking it fails the build. Non-text pairs that are *deliberately* below threshold
  are listed above and asserted as such.
- **Focus.** One policy, in `styles/base.css`: every interactive element gets the same 2px
  `--ring` at 2px offset. Components must not restate it. The board is fully keyboard-operable —
  arrows pan, `+`/`-` zoom, `0` fits, `1` resets — and does not claim `role="application"`.
- **Target size.** ≥ 24×24 (WCAG 2.5.8). `--control-height-sm` may not go below it.
- **Accessible names.** Every control has a real one. Icon-only buttons carry `aria-label` from
  `copy.ts`; state changes announce through `aria-live`.
- **Reduced motion.** Honoured everywhere via the single block in `tokens.css`.
- **Strings.** Every user-facing string comes from `web/src/copy.ts`. No string lives in markup or
  in CSS.

---

## Known gaps

Recorded rather than hidden:

1. **Mobile layout was broken and predates the redesign, and is much improved but not finished.**
   The icon rail gives the board back the ~72px of viewport the old text toolbar stack was
   eating, and the discard bin now clears it. Cards still scroll *under* the chrome at 390px,
   which is inherent to an infinite canvas rather than a defect to patch here. It wants its own
   ticket.
2. **shadcn is configured, not yet adopted.** `web/components.json` and the `@/*` alias exist so the
   CLI works, and the token layer is shadcn-shaped. No shadcn primitives are in the tree yet: the
   board, toolbar and timeline are geometry-driven and live inside a CSS `zoom` context, which
   utility-first primitives cannot express. Migrating them is a separate piece of work.
3. **Contrast is verified at token level, not per rendered element.** A pair that is fine on
   `--card` can still be wrong on `--accent-soft`. Worth a pass when the surfaces multiply.
4. **Twenty-card density is untested.** Both directions were validated at 12 cards; the layout
   seeks a 1:1 footprint, so 20 is plausible and both risks scale with count.
5. **Only one theme ships.** See below.
6. **The timeline is not yet day-agnostic.** `repeat(3, ...)` is hardcoded; see the timeline
   section. Owned by #69.
7. **The drag particle effect is in tension with this document.** `App.tsx` drops coloured sparks
   behind a dragged card. Its palette has been re-tokenised out of the old cosmic hexes and into
   amber and steel, but a glow is still a glow, and "banned: glows" above does not currently
   describe what the app does. Either relax the rule with a reason, or remove the effect. Not
   decided here.
8. **`grid-template-columns: repeat(3, …)` in `timeline.css` is also still a Saturday/Sunday
   assumption** in a second place, beyond the `copy.ts` ids named above. Same owner (#69).

---

## Theme decision

**Dark-first, single shipped theme.** Dark is chosen from the use scene — a student planning a
weekend at a desk at night — not from category habit.

The bootstrap token layer carried a `[data-theme='light']` block that nothing ever activated, so
light was unreachable and untested. That block is now a complete, specified second theme kept for
the future, but **nothing sets `data-theme` to it today**, and the test suite asserts the decision is
recorded and that dark is the shipped one.

Adding a second reachable theme means re-running the contrast gate against the new values. It is
not a matter of uncommenting a block.
