import type { Point, Rect } from './viewport';

/**
 * Board geometry, in **world units** (CSS px at 100% zoom).
 *
 * This module is the single source of truth: `App` imports it for layout maths and
 * `index.css` reads the same numbers through the `--card-*` custom properties, so the
 * drag overlay a user sees while dragging is pixel-identical to the board card it
 * replaces at every zoom level. Never re-declare these numbers in a component or in
 * a stylesheet rule — add them here and expose them as a custom property.
 */

/** Rendered width of one activity card on the canvas, in world units. */
export const CARD_WIDTH = 320;

/**
 * `min-height` for a canvas card, so cards line up in a grid. Tuned to the height of a
 * typical card, which keeps the visual rhythm without pinning the pitch to a guess.
 */
export const CARD_MIN_HEIGHT = 336;

/**
 * Height `contentBounds` assumes a card occupies. Deliberately larger than
 * `CARD_MIN_HEIGHT`: "fit view" should frame everything with room to spare rather than
 * clip the one card that has a longer rationale.
 */
export const CARD_FIT_HEIGHT = 432;

export const CARD_COLUMN_GAP = 40;
export const CARD_ROW_GAP = 40;
export const CARD_COLUMN_PITCH = CARD_WIDTH + CARD_COLUMN_GAP;
export const CARD_ROW_PITCH = CARD_FIT_HEIGHT + CARD_ROW_GAP;

/** Cards per row on the canvas before the grid wraps. */
export const BOARD_COLUMNS = 3;

/** Top-left corner of the default card grid, in world units. */
export const BOARD_GRID_ORIGIN: Point = { x: -520, y: -280 };

/** Spacing of the dot grid drawn behind the canvas, in world units. */
export const BOARD_GRID_SIZE = 40;

/** Breathing room `fitView` keeps between the content bounds and the board edge. */
export const BOARD_FIT_PADDING = 64;

/**
 * How long the discard animation runs. Must match `--motion-duration-base` in
 * `styles/card.css`; the card is removed from the store when it finishes.
 */
export const CARD_DISCARD_DURATION_MS = 180;

/** Bounds used before anything has been laid out. */
export const EMPTY_BOARD_BOUNDS: Rect = {
  x: BOARD_GRID_ORIGIN.x,
  y: BOARD_GRID_ORIGIN.y,
  width: CARD_WIDTH,
  height: CARD_FIT_HEIGHT,
};

/** Default grid slot for the card at `index`. Cards keep this position until dragged. */
export function defaultCardPosition(index: number): Point {
  const column = index % BOARD_COLUMNS;
  const row = Math.floor(index / BOARD_COLUMNS);

  return {
    x: BOARD_GRID_ORIGIN.x + column * CARD_COLUMN_PITCH,
    y: BOARD_GRID_ORIGIN.y + row * CARD_ROW_PITCH,
  };
}

/** World-space rectangle a card occupies at `position`. */
export function cardBounds(position: Point): Rect {
  return {
    x: position.x,
    y: position.y,
    width: CARD_WIDTH,
    height: CARD_FIT_HEIGHT,
  };
}

export type PlacedCard = {
  position: Point;
};

/**
 * Smallest world-space rectangle containing every card, so `fitView` frames the real
 * content — including cards a user has dragged away from their grid slot.
 */
export function contentBounds(cards: readonly PlacedCard[]): Rect {
  if (cards.length === 0) {
    return EMPTY_BOARD_BOUNDS;
  }

  const bounds = cards.map((card) => cardBounds(card.position));
  const left = Math.min(...bounds.map((rect) => rect.x));
  const top = Math.min(...bounds.map((rect) => rect.y));
  const right = Math.max(...bounds.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...bounds.map((rect) => rect.y + rect.height));

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}
