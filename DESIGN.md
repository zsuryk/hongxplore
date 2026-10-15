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

## The direction: Blue Hour

Hongxplore is an infinite whiteboard plus an agent that researches real activities in Hong Kong.
You ask in plain language, cards land on the board, and you drag the ones you want into a
weekend timeline.

The visual system is **Blue Hour** — the twenty minutes after a Hong Kong sunset, when the sky is
still a cold indigo and the city has already turned its lights on. That is also the product's
scene: a student planning a weekend at a desk at night. It is chosen from the use scene, not from
category habit, and it is a *relationship* rather than a mood, which is what makes it usable as a
token layer:

- a **cold, tinted ground** — ink, never a pure grey, because a dark UI with no hue in its
  neutrals reads as an unstyled `<div>`;
- a **cool steel lattice** drawn over it, in the same hue family, so the board reads as one lit
  material rather than as lines drawn on a hole;
- **sodium amber for anything waiting on the agent**, warm against all that cold;
- **harbour cyan for everything the user acts on** — the one saturated colour with a fill.

Four ideas carry it:

1. **One rule does the separating.** Not shadows, not fill contrast — a single 1px `--rule`
   value, reused as the card bezel, the card header divider, the timeline cell divider, the
   empty-slot drop target and the toolbar separator. Each card is a hole in a continuous lattice.
2. **Amber means pending, and nothing else.** It is the agent-log running lamp, the replacement
   prompt, the warning. It is never a border, because twelve amber outlines read as an error state.
   Cyan is the same discipline in the other direction: it is the user acting, never the agent waiting.
3. **There is a light source.** Every raised surface carries a 1px inner highlight along its top
   edge and a contact shadow under it; the canvas carries a broad wash from above and a vignette
   that closes the edges. This is the difference between a wireframe with fill and a room.
4. **Chrome recedes, cards do not.** Chrome sits behind or floats above the lattice; the cards are
   the only objects that get the full treatment.

### What was replaced, and what was not

This direction **replaced** the previous one — *Departure Board* — rather than polishing it. A
partial restyle of a discarded look is the failure mode this document exists to prevent. What the
rebrand discarded is recorded here so nobody re-derives it:

- **The palette.** Flat near-black `#0e0f11` with a steel-grey rule, one amber accent and a
  bootstrap blue. It was coherent and it passed contrast, and it was doing almost nothing: two
  neutral values, one hue, no relationship between them.
- **The material language.** A fill plus a 1px border, flat, on a ground with no light in it. No
  depth, no hierarchy beyond size, and nothing that caught a highlight.

What survived unchanged is the **functional spine**, because it is load-bearing and it is good:

- the rule-separated lattice, above;
- amber-means-pending;
- screen-space chrome and the pan/zoom split in [ADR-0009](docs/adr/0009-canvas-zoom-with-css-zoom);
- geometry owned by `boardLayout.ts`.

### Why not the obvious alternative

Direction A ("Municipal Mosaic") was prototyped to the same level and rejected, and the reason is
worth keeping because it constrains future design work here:

- Its identity lived in the **board ground**, a 40px world-space pattern. At 40% zoom the 1px
  grout falls below one device pixel and the mosaic disappears entirely. Repairing it needed a
  third layer outside `.board__pan`, which **amends ADR-0009**, and gave up world-locking.
- Its `--card` porcelain leaked into the timeline, making the timeline the brightest object on
  screen and inverting the hierarchy the product wants.

The canvas ground does carry the lattice now, so the constraint still binds: **any ground-level
signature must survive 40% zoom without an ADR amendment.** That is why the grid's fine line sits
at 11% and the major line carries the structure — at 40% zoom the fine pitch falls to ~16px, and
a ground pattern that only works at 100% is a ground pattern that disappears in the demo.

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
| `--background` | `#070b13` | the canvas |
| `--foreground` | `#eaf0f8` | primary text |
| `--card` | `#151d2e` | card and timeline-slot face |
| `--card-foreground` | `#eaf0f8` | card title, rationale |
| `--card-muted-foreground` | `#94a3bd` | district, venue, freshness |
| `--card-header` | `#101726` | the card's machined header plate, one step down |
| `--muted` / `--muted-foreground` | `#0d1421` / `#94a3bd` | recessed cells, chrome surfaces |
| `--primary` / `--primary-foreground` | `#ffa62b` / `#1a1206` | sodium amber — **pending only** |
| `--accent` / `--accent-foreground` | `#2cc8dc` / `#071019` | harbour cyan — the user acting |
| `--destructive` | `#f4615a` | discard, destructive confirmation |
| `--rule` | `#6b7b99` | **the** 1px structural rule |
| `--ring` | `#ffa62b` | focus |
| `--popover` / `--input` | `#1a2334` / `#0f1624` | floating surfaces |

**Every neutral is the same hue.** The canvas, the card, the chrome, the muted cell, the rule and
every divider are one indigo-slate family at different lightnesses. That is the whole trick
behind "modern dark UI": it is not darker greys, it is *tinted* greys, and the tint is what stops
the board reading as a hole. A future palette change that introduces a second neutral hue splits
the board into two materials; there must be one.

One more role carries the amber without carrying its weight: `--surface-pending`, a 9% amber wash
used only by the research placeholder's face. `--primary-soft` is the saturated brown the amber
drop-targets and the "replace this slot" decision use; at card size it outshouts the result cards
it is only standing in for, so the placeholder gets a wash instead and keeps the saturated version
for the 2px drop-target edges where the contrast against the slot is the point.

Brand tokens: `--lamp-live #2fd48a`, `--lamp-pending #ffa62b`, `--lamp-cancelled #f4615a`,
`--success`, `--warning`. `--lamp-halo` is the diffuser ring around a lit lamp.

Two families do different jobs and must not be merged:

- **Lamps** (`--lamp-*`) — a stage running, done, or failed.
- **Accent** (`--accent`) — a user-facing state on a surface.

#### The deliberate non-pair

**`--card` on `--background` is 1.17:1 and that is intentional.** Separation is carried entirely by
`--rule`, which measures 4.61:1 against the canvas and 3.94:1 against the card face. No dark fill
can do better: the first one that clears 3:1 is mid-grey, at which point this stops being a dark
board. `designSystem.test.ts` asserts this pair stays *below* 3:1, so a well-meaning PR cannot
"fix" it without updating this document.

Decorative hairlines use `--divider` (28%) and may sit below 3:1. WCAG 1.4.11 governs **meaningful
UI boundaries**, so anything a user has to see to operate a control uses `--rule` instead. Since
the rebrand the *rationale cell* is one of the few things that dropped to `--divider`: the card's
own bezel already carries the structural line, and spending `--rule` on a box inside the box made
twelve cards read as a page of heavy frames.

### Light and material

The rebrand's actual subject. Three mechanisms, and a rule about which surfaces get them:

- `--edge-light` — a 1px inner highlight along the top edge of every raised surface. On a dark
  UI this is the single cheapest thing that stops a card reading as a wireframe with fill, because
  a shadow alone says *how far off the plane* and an edge light says *where the light is*.
- `--shadow-contact` / `--shadow-lift` / `--shadow-raised` / `--shadow-drag` — layered by how far
  off the plane the thing is, never duplicated. **A card at rest gets contact only.** Its 1px
  `--rule` bezel is the separator; a wide soft shadow under a 1px border is the ghost-card look,
  and twelve of those is worse than twelve flat cards. The wide shadow is for hover, for the card
  the user is holding, and for **chrome**, which genuinely floats above the canvas — there the
  shadow describes the layer rather than outlining an object, so bezel and shadow together are
  correct.
- `--canvas-glow` / `--canvas-vignette` — the room the board sits in. An infinite canvas has no
  edges, so without a light source it renders as a flat field; the wash gives it a direction and
  the vignette gives it an inside.

**Elevation is declared once.** Every surface picks a border *or* a shadow from the scale above,
never a bespoke one.

### Typography

System font stacks only — no webfonts, no font downloads. CJK falls through `PingFang HK` /
`Noto Sans HK` / `Microsoft JhengHei`.

| Token | Size | Used for |
| --- | --- | --- |
| `--text-wordmark` | 19px | the wordmark — the app's only display voice |
| `--text-plate` | 21px | card serial, CJK title |
| `--text-title` | 17px | card title (Latin) |
| `--text-body` | 13.5px | match rationale |
| `--text-meta` | 12px | data values, venue, source, the tagline |
| `--text-label` | 11px | row labels, rank, slot labels, **every control** |

`--text-label` is the floor and it is load-bearing: it sets `--control-font`, so raising or lowering
it changes every button, chip and slot label in the app. **11px is the ceiling of what this scale
will go to.** 10.5px was the previous value and it was below the point where a tracked label stays
comfortable at 100% zoom on a laptop panel; the rebrand raised `--text-meta` from 11px to 12px at
the same time, so the two steps below the title are now 12 and 11 rather than 11 and 10.5, and the
ramp reads as deliberate instead of merely small.

**Bilingual type.** Card titles arrive in Traditional Chinese, English, or both. Tracking opens as
size closes (`--tracking-label: 0.085em` on 11px) and closes as size opens
(`--tracking-title: -0.012em` on 17px, `--tracking-display: -0.025em` on the wordmark), which is
what keeps small caps legible without going bold while making a title look typeset rather than
typed. The font stack carries a `--cjk-weight-bump` so CJK sits at an optical weight matching the
Latin beside it rather than looking thin.

### Spacing, radius, elevation

Spacing is a `--space-1` … `--space-10` scale. Radii ramp with **surface size**, not with era:
`--radius-xs` 3px → `--radius-sm` 5px → `--radius-md` 8px → `--radius-lg` 12px →
`--radius-card` 14px, and only fully round things get `--radius-pill`. The card is the largest
surface on screen and takes the largest radius; the previous identity's near-square 2–6px ramp
made every cell read as a machined plate and every plate read as the same size.

Elevation is covered under **Light and material** above. The short version: one scale, declared
once, contact-at-rest on cards, wide on chrome and on the card in hand.

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

The drag particles that fall behind a lifted card keep their motion but lost their bloom: they are
flat `--particle-*` dots now. The motion is the information — something is being carried — and the
glow was decoration competing with the accent colour.

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
primary action; identity sits quietly to one side of it. It is still an Operate surface, so the
wordmark does not outrank the search box beside it — but it does get the app's only display size,
negative tracking, and a 2px **signal line** along the very top that runs cyan into amber. That
line is the palette stating its own relationship once, at the only place on screen wide enough to
say it; it must stay under 2px and must never animate.

Header and agent-status strip share one `--chrome-raised` → `--chrome` gradient and are closed off
with a single `--rule`, so the two chrome blocks read as **one band** rather than as two slabs.
The status strip continues the gradient down into `--background`, which hands the board off
without a hard edge.

### Browser surfaces

**Selection, the caret and the scrollbars ship with the browser and belong to no design system.**
Dragging across a card on a themed canvas otherwise produces a stock highlighter in the middle of
a palette with a point of view. They are themed in `base.css`, in one place, from the same tokens:
`::selection` takes `--accent` over `--foreground-inverse`, the caret takes `--accent`, and
scrollbars take `--divider-strong` on a thin track.

### Activity card

Anatomy, in order: **header plate** (`--text-plate` serial plate in mono, district as a tracked
caps label, then a sub-row of language chip and departure time in tabular mono) → **1px `--rule`
divider** → **title** (with the original CJK title beneath it when the title was translated) →
**ruled data rows** (`Venue` / `Price` / `Listed`, a fixed label gutter so every card's values
align) → **rationale** in a recessed cell → **footer** (source link + find similar).

**The header runs full-bleed and one step below the card face**, which is the one structural
change the new material language needs: a recessed band across the top is what makes the card read
as a milled object catching light from above rather than as a filled rectangle with a border. That
required moving the card's padding onto its three regions — `--card-pad-x` / `--card-pad-y` are
set on the card and overridden per variant, so a full-bleed band and a variant-specific inset
stay in agreement without either restating the other.

The serial is the card's index in the **full** card list, not in the cards currently on the
canvas, so docking or discarding never renumbers the cards that remain. It is `aria-hidden`: a
row number the eye reads adds nothing to the card's accessible name. It is deliberately *not*
`--foreground`; at 21px it is the largest glyph on the card, and if it were also the brightest the
serial would outrank the title it labels.

The **content-driven height rule**: the card's height is set by its content, never by a
hard-coded value. Variants (`compact`, `wide`, `tall`) set a *minimum* via `--card-min-height`,
`--card-compact-min-height`, `--card-wide-min-height`, `--card-tall-min-height` — all injected by
`boardLayout.ts` — and grow past it. A title that wraps to three lines must push the card taller,
not clip or overflow. This is why `--card-min-height` is the one number written in two languages,
and why that coupling is commented in both.

The rationale is a **sunken `--muted` well**, distinguished by recession and by its tracked-caps
label rather than by a coloured stripe: a 3px accent `border-left` on every card would turn the
board into a set of callout boxes and spend `--accent` — the state colour — on something that is
not a state. It carries **no border**: a filled, bordered box inside a bordered card is a card
inside a card, and the `--rule` under the data block already separates it from everything above.

The serial plate is deliberately one step below `--card-muted-foreground` (`--card-plate`, 5.14:1
on the header plate). It used to reach that dimness with an `opacity`, which quietly took it to
4.2:1 — below the 4.5:1 body floor, and invisible to a test that only reads the token layer. A
dimmed colour is a **token**, never an opacity on top of one.

The same component renders at two sizes — `size="canvas"` on the board and `size="docked"` in a
timeline slot — sharing one token set. The docked size drops the serial, the data rows and the
rationale and re-reads the card as a time, a title and a place. Because it has no header plate to
bleed into, it takes its own padding back at `--radius-md`.

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

The rail is **glass**: `--chrome-surface` at 86% over an 18px backdrop blur, with the wide
elevation shadow and the same edge light as every other floating surface. That is the one place
blur is load-bearing rather than decorative — the rail sits over a lattice that would otherwise
read straight through it.

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
7. **`grid-template-columns: repeat(3, …)` in `timeline.css` is also still a Saturday/Sunday
   assumption** in a second place, beyond the `copy.ts` ids named above. Same owner (#69).
8. **Two of three card variants have never been seen rendered.** Every card resolves to `tall`
   with the current seed data, so `compact` and `wide` were designed on paper only. Which variant a
   card gets is a `boardLayout` heuristic decision, not a design one, but a reviewer should not
   assume those two look right.
9. **The card serial is an array index, not a board position.** It is stable across docking and
   discarding, but it does not tell you where on the board a card sits. Deliberate, and noted in
   the code.
10. **Card placement has no safety margin, and the rebrand nearly exposed it.** This is a layout
    finding, not a design one, and it belongs to the board-layout pass. `computeBoardLayout`
    stacks the first six cards with `tiledCardPosition(index, undefined, compactHeight)`, where
    `compactHeight` comes from a `ResizeObserver` measurement. That measurement is captured while
    the card is still sitting at its `--card-tall-min-height` floor, so it **under-reports** the
    rendered height by roughly 40 world units; the renderer then relies on `+ 40` of padding to
    absorb the error. Before the rebrand the slack was 2.3 world units. Restyling the card even 8
    units taller tipped it over and two cards visibly overlapped at rest. The rebrand was pulled
    back to restore the slack, but **the margin is still effectively zero**: any change to card
    padding, leading or font metrics can reintroduce the overlap. The fix is to stop trusting a
    first-paint measurement — re-measure after layout settles, or pack against
    `CARD_FIT_HEIGHT` the way `contentBounds` already does.
11. **The canvas is still mostly empty at 1600×1000 with three cards.** Framing and auto-fit are
    layout decisions owned by the same pass as item 10. Appearance-wise the vignette and lattice
    now make an unbounded board read as a lit space rather than as a void, but the composition is
    still three cards in the middle of a very large dark field.

---

## Theme decision

**Dark-first, single shipped theme**, shipped under the name its world gives it: `[data-theme='blue-hour']`.
Dark is chosen from the use scene — a student planning a weekend at a desk at night — not from
category habit, and the light version of the same scene is not the same surface.

The bootstrap token layer carried a `[data-theme='light']` block that nothing ever activated, so
light was unreachable and untested. That block is now a complete, specified second theme kept for
the future — the same hue ramp inverted, with amber and cyan re-picked for their lightness rather
than copied, because an accent that clears 8:1 on ink does not clear 4.5:1 on paper. **Nothing
sets `data-theme` to it today**, and the test suite asserts the decision is recorded and that dark
is the shipped one.

Adding a second reachable theme means re-running the contrast gate against the new values. It is
not a matter of uncommenting a block.
