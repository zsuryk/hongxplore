# ADR-0009: The canvas zooms with CSS `zoom`, and chrome stays in screen space

- **Status:** accepted
- **Date:** 2026-10-04

## Context

The board is an infinite canvas: cards live in a world coordinate system, and pan/zoom maps that world onto the board element (`web/src/viewport.ts`). Two problems came out of how that mapping was rendered (issue #48).

The world layer was scaled with `transform: translate3d(x, y, 0) scale(s)`. A CSS transform scales a rendered layer as a bitmap: text, borders, radii and shadows are rasterised once at their untransformed size and then stretched, so card text went soft above ~100% and card shadows ballooned with the zoom factor. The board's own box never moved, but everything that was *not* inside the transformed layer — the drag overlay, the docked timeline cards — stayed at 1x, so lifting a card visibly resized it by exactly the zoom factor.

Separately, the board mixes two kinds of content: **cards**, which belong to the world and should scale, and **chrome** — the timeline, discard bin, guide/empty state, confirmation toast, zoom toolbar — which belongs to the viewport and should not. Both were rendered as siblings with no distinction, and the world-space overlays were anchored with `left: 0; transform: translateX(-50%); width: min(34rem, 100vw - 2rem)`, which ties them to the world's origin (so they drift off-screen when panning) and to the *window* width rather than the board width.

## Decision

**Two nested layers, with pan and zoom deliberately split.**

- `.board__pan` — screen space. Carries the pan offset and nothing else: `transform: translate3d(var(--board-pan-x), var(--board-pan-y), 0)`.
- `.board__world` — world space. Carries `zoom: var(--board-zoom)`, which makes the browser re-lay-out and re-rasterise text at the new scale instead of stretching a bitmap.

The split matters: `zoom` multiplies the used values of lengths *and* positioned offsets in its subtree, so putting `zoom` and a screen-space offset on the same element would make "this many pixels from the left" ambiguous. With the pan on an unzoomed parent and the zoom on a zoomed child, every screen-space offset stays in real pixels, every world-space length stays in world units, and `getBoundingClientRect()` agrees exactly with the `viewport.ts` maths (which is what makes pointer→world→pointer round-trips correct while dragging).

`.board__drag` mirrors the same structure — an unzoomed screen-positioned wrapper with a `zoom`ed, `--card-width`-wide child — so the card under the pointer is pixel-identical to the board card it replaces at every zoom level.

**Chrome renders outside `.board__pan`**, positioned against the board element rather than the world. The timeline and discard bin already did; the guide, empty state and confirmation moved there too. A card is the only thing that scales with the world.

**Board geometry lives in TypeScript, not CSS.** `web/src/boardLayout.ts` owns card width, grid pitch, fit padding and the content bounds used by "fit view"; `App` publishes those numbers to CSS as `--card-*` / `--board-*` custom properties on the board element. That is the only way the drag overlay, the card and the fit maths can stay in agreement without restating the same numbers in two languages. The one place the coupling is documented rather than enforced is `--card-min-height`, whose value is written in both `boardLayout.ts` and `styles/card.css`'s defaults.

**Transitions are reserved for discrete steps.** Wheel, pinch and drag apply immediately (a transition makes the board lag behind the pointer); the toolbar buttons, keyboard zoom and "fit" animate over `--motion-duration-base`. `prefers-reduced-motion` collapses both.

`css.zoom` is supported in Chromium and Safari and in Firefox from 126; where a browser cannot interpolate it, discrete zoom steps snap instead of animating, which is a graceful degradation.

## Consequences

- Card text is crisp at every zoom level, and typography, padding, radius and shadow scale with the board instead of smearing.
- "Fit view" frames the real content — including cards a user dragged off the grid — instead of a hard-coded rectangle that never matched the layout, and it is allowed to scale below the interactive zoom minimum rather than silently failing to fit.
- Dragging a card no longer resizes it; hit targets and hover lifts scale with the card they belong to.
- Chrome never blurs, drifts off-screen, or depends on `100vw` (which ignored the board's actual width and any window chrome).
- Pan and zoom survive a window resize: the board element is observed with `ResizeObserver` and the resize anchors on the current centre, instead of a `window` resize listener re-fitting and throwing the view away.
- Adding a new zoomable surface means nesting it inside `.board__world`; adding a new panel means rendering it as a sibling. Getting this backwards is visible immediately, which is the point.
- `zoom` in the subtree makes `%`-sized and viewport-unit children behave relative to the zoom, so world-space content must not use `vh`/`vw` units.
- Trade-off: docked timeline cards stay a constant size while the board zooms. That is deliberate — a parked card is a reference, not a canvas node, and it keeps its text legible at any zoom — but it does mean the same component renders at two sizes, hence the explicit `size="canvas" | "docked"` variant sharing one token set rather than two components drifting apart.