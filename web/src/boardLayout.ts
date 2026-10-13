import { isRectInViewport, type Point, type Rect, type Viewport } from './viewport';

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

export type CardVariant = 'compact' | 'wide' | 'tall' | 'standard';

export const CARD_VARIANT_DIMENSIONS: Record<CardVariant, { width: number; minHeight: number; fitHeight: number }> = {
  standard: { width: 320, minHeight: 336, fitHeight: 432 },
  compact: { width: 320, minHeight: 220, fitHeight: 250 },
  wide: { width: 320, minHeight: 200, fitHeight: 230 },
  tall: { width: 320, minHeight: 440, fitHeight: 480 },
};

export type ActivityMatch = {
  activity: {
    id: string;
    title: string;
    title_en?: string | null;
    tags?: string[];
    [key: string]: unknown;
  };
  match_rationale?: string;
  [key: string]: unknown;
};

/**
 * Derives a card's visual variant ('compact' | 'wide' | 'tall') strictly from its content.
 * Guarantees that any two cards with equal content share the exact same shape
 * regardless of where they sit on the board or what list index they occupy.
 */
export function getCardVariantFromContent(card: ActivityMatch): CardVariant {
  const rationale = card.match_rationale ?? '';
  const tags = card.activity.tags ?? [];
  const title = card.activity.title_en ?? card.activity.title ?? '';
  const contentScore = rationale.length + tags.length * 8 + title.length;

  if (contentScore < 80) {
    return 'compact';
  }
  if (contentScore < 160) {
    return 'wide';
  }
  return 'tall';
}

/**
 * Assigns a visual variant according to index or card content.
 * When given an activity match, derives the shape purely from its content.
 */
export function getCardVariant(input: number | ActivityMatch): CardVariant {
  if (typeof input === 'number') {
    const mod = input % 3;
    if (mod === 0) return 'compact';
    if (mod === 1) return 'wide';
    return 'tall';
  }
  return getCardVariantFromContent(input);
}

/** Default grid slot for the card at `index`. Cards keep this position until dragged. */
export function defaultCardPosition(index: number): Point {
  const column = index % BOARD_COLUMNS;
  const row = Math.floor(index / BOARD_COLUMNS);

  return {
    x: BOARD_GRID_ORIGIN.x + column * CARD_COLUMN_PITCH,
    y: BOARD_GRID_ORIGIN.y + row * CARD_ROW_PITCH,
  };
}

/**
 * Computes how many 3-card clusters to place per horizontal tier.
 * For 1-5 cards, keeps 2 clusters (up to 4 columns) to match the whiteboard baseline.
 * As the collection grows beyond 5 cards, expands horizontally (3, 4, 5+ clusters per row)
 * so that the layout keeps a balanced, square-proportioned aspect ratio rather than
 * growing into an endlessly tall vertical column.
 */
export function getClustersPerRow(totalCards: number = 0): number {
  if (totalCards <= 5) {
    return 2;
  }
  const totalClusters = Math.ceil(totalCards / 3);
  if (totalClusters <= 6) {
    return 3;
  }
  if (totalClusters <= 12) {
    return 4;
  }
  return Math.max(4, Math.ceil(Math.sqrt(totalClusters * 1.4)));
}

/**
 * Organic auto-tiling layout: packs cards in 3-card clusters (Compact stacked over Wide
 * in column A, with Tall spanning full height in column B) matching the whiteboard sketch.
 * Dynamically adjusts clusters per row based on `totalCards` to maintain a balanced,
 * square layout area.
 */
export function tiledCardPosition(index: number, totalCards?: number): Point {
  const clusterIndex = Math.floor(index / 3);
  const slotInCluster = index % 3;

  const clustersPerRow = totalCards !== undefined ? getClustersPerRow(totalCards) : 2;
  const clusterCol = clusterIndex % clustersPerRow;
  const clusterRow = Math.floor(clusterIndex / clustersPerRow);

  const clusterPitchX = (CARD_WIDTH + 56) * 2;
  const clusterPitchY = 560 + 56;

  const clusterX = BOARD_GRID_ORIGIN.x + clusterCol * clusterPitchX;
  const clusterY = BOARD_GRID_ORIGIN.y + clusterRow * clusterPitchY;

  if (slotInCluster === 0) {
    // Compact: top-left of cluster
    return { x: clusterX, y: clusterY };
  }
  if (slotInCluster === 1) {
    // Wide: bottom-left of cluster, stacked comfortably under Compact with ample clearance
    return { x: clusterX, y: clusterY + 310 };
  }
  // Tall: right column of cluster, spanning full height
  return { x: clusterX + (CARD_WIDTH + 56), y: clusterY };
}

/** Determines if two rectangles overlap with an optional margin of breathing room. */
export function rectsOverlap(a: Rect, b: Rect, margin: number = 0): boolean {
  return (
    a.x - margin < b.x + b.width &&
    a.x + a.width + margin > b.x &&
    a.y - margin < b.y + b.height &&
    a.y + a.height + margin > b.y
  );
}

/** World-space rectangle a card occupies at `position`. */
export function cardBounds(position: Point, variant: CardVariant = 'standard'): Rect {
  const dimensions = CARD_VARIANT_DIMENSIONS[variant];
  return {
    x: position.x,
    y: position.y,
    width: dimensions.width,
    height: dimensions.fitHeight,
  };
}

export type PlacedCard = {
  position: Point;
  variant?: CardVariant;
  width?: number;
  height?: number;
};

/**
 * Smallest world-space rectangle containing every card, so `fitView` frames the real
 * content — including cards a user has dragged away from their grid slot.
 */
export function contentBounds(cards: readonly PlacedCard[]): Rect {
  if (cards.length === 0) {
    return EMPTY_BOARD_BOUNDS;
  }

  const bounds = cards.map((card) => {
    const width = card.width ?? (card.variant ? CARD_VARIANT_DIMENSIONS[card.variant].width : CARD_WIDTH);
    const height = card.height ?? (card.variant ? CARD_VARIANT_DIMENSIONS[card.variant].fitHeight : CARD_FIT_HEIGHT);
    return {
      x: card.position.x,
      y: card.position.y,
      width,
      height,
    };
  });
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

/**
 * Best-Fit Squareness Slot Seeking (Approach 2):
 * Dynamically finds the optimal non-colliding placement slot for an incoming card of
 * `variant` relative to all currently placed cards on the board (including user-dragged ones).
 * Evaluates candidate slots adjacent to existing cards, ensuring zero collision
 * and minimizing the aspect ratio error |Width - Height| of the resulting bounding box.
 */
export function findBestSquareSlot(
  variant: CardVariant,
  existingCards: readonly PlacedCard[],
  origin: Point = BOARD_GRID_ORIGIN,
): Point {
  if (existingCards.length === 0) {
    return origin;
  }

  const dimensions = CARD_VARIANT_DIMENSIONS[variant];
  const newW = dimensions.width;
  const newH = dimensions.fitHeight;
  const currBounds = contentBounds(existingCards);
  const center = {
    x: currBounds.x + currBounds.width / 2,
    y: currBounds.y + currBounds.height / 2,
  };

  const GAP_X = 56;
  const GAP_Y = 56;
  const candidates: Point[] = [];

  for (const card of existingCards) {
    const cDim = CARD_VARIANT_DIMENSIONS[card.variant ?? 'standard'];
    const cW = card.width ?? cDim.width;
    const cH = card.height ?? cDim.fitHeight;

    // Right of card
    candidates.push({ x: card.position.x + cW + GAP_X, y: card.position.y });
    // Left of card
    candidates.push({ x: card.position.x - newW - GAP_X, y: card.position.y });
    // Below card
    candidates.push({ x: card.position.x, y: card.position.y + cH + GAP_Y });
    // Above card
    candidates.push({ x: card.position.x, y: card.position.y - newH - GAP_Y });
    // Diagonal bottom-right
    candidates.push({ x: card.position.x + cW + GAP_X, y: card.position.y + cH + GAP_Y });

    // When card above is Compact, place Wide comfortably stacked underneath
    if (card.variant === 'compact') {
      candidates.push({ x: card.position.x, y: card.position.y + 310 });
    }
  }

  let bestPoint: Point | null = null;
  let bestScore = Infinity;

  for (const pt of candidates) {
    const candRect: Rect = { x: pt.x, y: pt.y, width: newW, height: newH };

    // Avoid colliding with any existing card (allow 10px breathing room)
    const collides = existingCards.some((other) => {
      const otherRect = cardBounds(other.position, other.variant ?? 'standard');
      return rectsOverlap(candRect, otherRect, 10);
    });

    if (collides) {
      continue;
    }

    const nextMinX = Math.min(currBounds.x, pt.x);
    const nextMaxX = Math.max(currBounds.x + currBounds.width, pt.x + newW);
    const nextMinY = Math.min(currBounds.y, pt.y);
    const nextMaxY = Math.max(currBounds.y + currBounds.height, pt.y + newH);
    const nextW = nextMaxX - nextMinX;
    const nextH = nextMaxY - nextMinY;

    // Squareness penalty: deviation from 1:1 aspect ratio
    const squarenessPenalty = Math.abs(nextW - nextH);

    // Distance penalty: keep within the center of content mass
    const cardCenterX = pt.x + newW / 2;
    const cardCenterY = pt.y + newH / 2;
    const distFromCenter = Math.hypot(cardCenterX - center.x, cardCenterY - center.y);

    const score = squarenessPenalty * 1.0 + distFromCenter * 0.35;

    if (score < bestScore) {
      bestScore = score;
      bestPoint = pt;
    }
  }

  // Fallback if all adjacent slots were obstructed
  if (!bestPoint) {
    if (currBounds.width >= currBounds.height) {
      return { x: currBounds.x, y: currBounds.y + currBounds.height + GAP_Y };
    }
    return { x: currBounds.x + currBounds.width + GAP_X, y: currBounds.y };
  }

  return bestPoint;
}

/**
 * Checks if any of the given placed cards are currently outside the screen container
 * bounds (or partially cut off) at the current viewport.
 */
export function areAnyCardsOutOfFrame(
  cards: readonly PlacedCard[],
  viewport: Viewport,
  container: { width: number; height: number },
  padding: number = 32,
): boolean {
  if (cards.length === 0 || container.width <= 0 || container.height <= 0) {
    return false;
  }

  return !isRectInViewport(contentBounds(cards), viewport, container, padding);
}

/**
 * Maps an activity ISO start timestamp to its matching weekend timeline slot ID.
 * Hong Kong Time (UTC+8):
 * - Saturday / Sunday
 * - Morning (< 12:00)
 * - Afternoon (12:00 - 18:00)
 * - Evening (>= 18:00)
 */
export function getActivityMatchingSlotId(startIso?: string | null): string | null {
  if (!startIso) return null;
  try {
    const date = new Date(startIso);
    if (isNaN(date.getTime())) return null;

    const weekday = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      timeZone: 'Asia/Hong_Kong',
    }).format(date);

    const hourStr = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: 'Asia/Hong_Kong',
    }).format(date);
    const hour = parseInt(hourStr, 10);

    const dayPrefix = weekday === 'Sat' ? 'saturday' : weekday === 'Sun' ? 'sunday' : null;
    if (!dayPrefix) return null;

    let period = 'afternoon';
    if (hour < 12) {
      period = 'morning';
    } else if (hour < 18) {
      period = 'afternoon';
    } else {
      period = 'evening';
    }

    return `${dayPrefix}-${period}`;
  } catch {
    return null;
  }
}

export type PlacedBoardCard<T extends ActivityMatch = ActivityMatch> = {
  card: T;
  position: Point;
  variant: CardVariant;
  isDocked: boolean;
};

export type ComputeBoardLayoutOptions<T extends ActivityMatch = ActivityMatch> = {
  /** The cards currently active on the board. */
  cards: readonly T[];
  /** IDs of cards currently docked in the timeline. */
  dockedCardIds?: ReadonlySet<string> | readonly string[];
  /** Custom dragged positions by activity ID. */
  customPositions?: Readonly<Record<string, Point>>;
  /** Previously assigned or pinned layout positions by activity ID. */
  assignedPositions?: Readonly<Record<string, Point>>;
  /** Discarded cards that were previously on the board, to preserve slot indices. */
  discardedCards?: readonly T[];
};

export type ComputeBoardLayoutResult<T extends ActivityMatch = ActivityMatch> = {
  /** All placed cards (both docked and undocked). */
  allPlacedCards: PlacedBoardCard<T>[];
  /** Only undocked cards that should render on the canvas. */
  canvasCards: PlacedBoardCard<T>[];
  /** Complete map of card positions by activity ID. */
  positionsById: Record<string, Point>;
  /** Complete map of card variants by activity ID. */
  variantsById: Record<string, CardVariant>;
};

/**
 * Pure board layout computation:
 * Maps cards to non-colliding positions and variants such that:
 * 1. Docking, undocking, dragging, adding or discarding any card leaves every other card
 *    in its exact same position and shape.
 * 2. Two cards with identical content share the exact same shape.
 * 3. Newly arriving cards seek non-colliding slots that steer toward a 1:1 square footprint.
 */
export function computeBoardLayout<T extends ActivityMatch>({
  cards,
  dockedCardIds = [],
  customPositions = {},
  assignedPositions = {},
  discardedCards = [],
}: ComputeBoardLayoutOptions<T>): ComputeBoardLayoutResult<T> {
  const dockedSet = dockedCardIds instanceof Set ? dockedCardIds : new Set(dockedCardIds);
  const positionsById: Record<string, Point> = { ...assignedPositions };
  const variantsById: Record<string, CardVariant> = {};
  const allPlacedCards: PlacedBoardCard<T>[] = [];
  const canvasCards: PlacedBoardCard<T>[] = [];

  // Reconstruct introduced cards sequence to ensure stable slot indices even if some are discarded
  const knownCardsMap = new Map<string, T>();
  for (const card of cards) {
    knownCardsMap.set(card.activity.id, card);
  }
  for (const card of discardedCards) {
    if (!knownCardsMap.has(card.activity.id)) {
      knownCardsMap.set(card.activity.id, card);
    }
  }

  // Accumulate occupied rects for collision-free placement of newly added cards
  const existingUndockedPlaced: PlacedCard[] = [];

  let initialSlotIndex = 0;
  for (const [cardId, card] of knownCardsMap.entries()) {
    const isDocked = dockedSet.has(cardId);
    const isDiscarded = !cards.some((c) => c.activity.id === cardId);
    const variant = getCardVariantFromContent(card);
    variantsById[cardId] = variant;

    let position: Point;
    if (customPositions[cardId]) {
      position = customPositions[cardId];
    } else if (positionsById[cardId]) {
      position = positionsById[cardId];
    } else {
      if (initialSlotIndex < 6) {
        position = tiledCardPosition(initialSlotIndex);
      } else {
        position = findBestSquareSlot(variant, existingUndockedPlaced);
      }
      positionsById[cardId] = position;
    }
    initialSlotIndex += 1;

    const placedCard: PlacedBoardCard<T> = {
      card,
      position,
      variant,
      isDocked,
    };

    if (!isDiscarded) {
      allPlacedCards.push(placedCard);
      if (!isDocked) {
        canvasCards.push(placedCard);
        existingUndockedPlaced.push({
          position,
          variant,
        });
      }
    }
  }

  return {
    allPlacedCards,
    canvasCards,
    positionsById,
    variantsById,
  };
}
