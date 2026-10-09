import { describe, expect, it } from 'vitest';
import {
  BOARD_COLUMNS,
  BOARD_GRID_ORIGIN,
  CARD_FIT_HEIGHT,
  CARD_WIDTH,
  EMPTY_BOARD_BOUNDS,
  areAnyCardsOutOfFrame,
  cardBounds,
  contentBounds,
  defaultCardPosition,
  findBestSquareSlot,
  getActivityMatchingSlotId,
  getCardVariant,
  getClustersPerRow,
  rectsOverlap,
  tiledCardPosition,
  type PlacedCard,
} from './boardLayout';

describe('default card layout', () => {
  it('lays cards out in rows of BOARD_COLUMNS', () => {
    const firstRow = Array.from({ length: BOARD_COLUMNS }, (_, index) => defaultCardPosition(index));

    expect(new Set(firstRow.map((position) => position.y)).size).toBe(1);
    expect(new Set(firstRow.map((position) => position.x)).size).toBe(BOARD_COLUMNS);
    expect(firstRow[0]).toEqual(BOARD_GRID_ORIGIN);
  });

  it('wraps onto the next row without overlapping the previous one', () => {
    const lastOfFirstRow = defaultCardPosition(BOARD_COLUMNS - 1);
    const firstOfSecondRow = defaultCardPosition(BOARD_COLUMNS);

    expect(firstOfSecondRow.x).toBe(BOARD_GRID_ORIGIN.x);
    expect(firstOfSecondRow.y).toBeGreaterThanOrEqual(lastOfFirstRow.y + CARD_FIT_HEIGHT);
  });

  it('gives every card the same size', () => {
    const positions = Array.from({ length: 7 }, (_, index) => defaultCardPosition(index));
    const bounds = contentBounds(positions.map((position) => ({ position })));

    // 7 cards at 3 per row -> 3 columns x 3 rows of grid slots.
    expect(bounds.width).toBe(CARD_WIDTH * BOARD_COLUMNS + (BOARD_COLUMNS - 1) * 40);
    expect(bounds.height).toBe(CARD_FIT_HEIGHT * 3 + 2 * 40);
  });
});

describe('content bounds', () => {
  it('falls back to a single card-sized rect when the board is empty', () => {
    expect(contentBounds([])).toEqual(EMPTY_BOARD_BOUNDS);
  });

  it('frames every card, including one dragged outside the grid', () => {
    const draggedFarRight = { position: { x: 900, y: -600 } };

    const bounds = contentBounds([
      { position: defaultCardPosition(0) },
      { position: defaultCardPosition(1) },
      draggedFarRight,
    ]);

    expect(bounds.x).toBe(BOARD_GRID_ORIGIN.x);
    expect(bounds.y).toBe(-600);
    expect(bounds.x + bounds.width).toBe(900 + CARD_WIDTH);
    expect(bounds.y + bounds.height).toBe(BOARD_GRID_ORIGIN.y + CARD_FIT_HEIGHT);
  });

  it('grows to fit a single card placed anywhere', () => {
    const bounds = contentBounds([{ position: { x: -1000, y: 1000 } }]);

    expect(bounds).toEqual({ x: -1000, y: 1000, width: CARD_WIDTH, height: CARD_FIT_HEIGHT });
  });

  it('takes card variant dimensions into account', () => {
    const bounds = contentBounds([
      { position: { x: 0, y: 0 }, variant: 'compact' },
      { position: { x: 400, y: 0 }, variant: 'tall' },
    ]);

    expect(bounds.x).toBe(0);
    expect(bounds.y).toBe(0);
    expect(bounds.width).toBe(400 + 320);
    expect(bounds.height).toBe(480);
  });
});

describe('auto-tiling and card variants', () => {
  it('cycles variants through compact, wide, and tall deterministically', () => {
    expect(getCardVariant(0)).toBe('compact');
    expect(getCardVariant(1)).toBe('wide');
    expect(getCardVariant(2)).toBe('tall');
    expect(getCardVariant(3)).toBe('compact');
  });

  it('tiles cards within a cluster without overlapping', () => {
    const compactPos = tiledCardPosition(0);
    const widePos = tiledCardPosition(1);
    const tallPos = tiledCardPosition(2);

    // Compact and wide are in column A, wide stacked under compact
    expect(compactPos.x).toBe(widePos.x);
    expect(widePos.y).toBeGreaterThan(compactPos.y);

    // Tall is in column B to the right of column A
    expect(tallPos.x).toBeGreaterThan(compactPos.x);
    expect(tallPos.y).toBe(compactPos.y);
  });

  it('expands clusters per row past 5 cards to maintain square aspect ratio', () => {
    expect(getClustersPerRow(3)).toBe(2);
    expect(getClustersPerRow(5)).toBe(2);
    expect(getClustersPerRow(6)).toBe(3);
    expect(getClustersPerRow(9)).toBe(3);
    expect(getClustersPerRow(12)).toBe(3);
    expect(getClustersPerRow(20)).toBe(4);
  });

  it('positions clusters horizontally across 3 columns when totalCards exceeds 5', () => {
    const posCluster0 = tiledCardPosition(0, 9);
    const posCluster1 = tiledCardPosition(3, 9);
    const posCluster2 = tiledCardPosition(6, 9);

    expect(posCluster0.y).toBe(posCluster1.y);
    expect(posCluster1.y).toBe(posCluster2.y);
    expect(posCluster1.x).toBeGreaterThan(posCluster0.x);
    expect(posCluster2.x).toBeGreaterThan(posCluster1.x);
  });
});

describe('getActivityMatchingSlotId', () => {
  it('maps Saturday morning and afternoon timestamps accurately in HKT', () => {
    // 2026-10-10 01:00 UTC = 09:00 HKT (Saturday morning)
    expect(getActivityMatchingSlotId('2026-10-10T01:00:00Z')).toBe('saturday-morning');
    // 2026-10-10 06:00 UTC = 14:00 HKT (Saturday afternoon)
    expect(getActivityMatchingSlotId('2026-10-10T06:00:00Z')).toBe('saturday-afternoon');
    // 2026-10-10 11:00 UTC = 19:00 HKT (Saturday evening)
    expect(getActivityMatchingSlotId('2026-10-10T11:00:00Z')).toBe('saturday-evening');
  });

  it('maps Sunday slots accurately in HKT', () => {
    // 2026-10-11 02:00 UTC = 10:00 HKT (Sunday morning)
    expect(getActivityMatchingSlotId('2026-10-11T02:00:00Z')).toBe('sunday-morning');
    // 2026-10-11 07:00 UTC = 15:00 HKT (Sunday afternoon)
    expect(getActivityMatchingSlotId('2026-10-11T07:00:00Z')).toBe('sunday-afternoon');
    // 2026-10-11 11:30 UTC = 19:30 HKT (Sunday evening)
    expect(getActivityMatchingSlotId('2026-10-11T11:30:00Z')).toBe('sunday-evening');
  });

  it('returns null for missing, invalid or weekday dates', () => {
    expect(getActivityMatchingSlotId(undefined)).toBeNull();
    expect(getActivityMatchingSlotId(null)).toBeNull();
    expect(getActivityMatchingSlotId('invalid-date')).toBeNull();
    // Friday: 2026-10-09T06:00:00Z
    expect(getActivityMatchingSlotId('2026-10-09T06:00:00Z')).toBeNull();
  });

  it('detects when cards are out of frame', () => {
    const vp = { x: 0, y: 0, scale: 1 };
    const container = { width: 1000, height: 800 };

    const inFrameCards = [
      { position: { x: 50, y: 50 }, variant: 'standard' as const },
      { position: { x: 400, y: 50 }, variant: 'standard' as const },
    ];
    expect(areAnyCardsOutOfFrame(inFrameCards, vp, container, 32)).toBe(false);

    const outOfFrameCards = [
      { position: { x: 50, y: 50 }, variant: 'standard' as const },
      { position: { x: 900, y: 50 }, variant: 'standard' as const },
    ];
    expect(areAnyCardsOutOfFrame(outOfFrameCards, vp, container, 32)).toBe(true);

    expect(areAnyCardsOutOfFrame([], vp, container, 32)).toBe(false);
  });
});

describe('findBestSquareSlot', () => {
  it('returns origin on empty board', () => {
    expect(findBestSquareSlot('standard', [])).toEqual(BOARD_GRID_ORIGIN);
    expect(findBestSquareSlot('wide', [], { x: 100, y: 200 })).toEqual({ x: 100, y: 200 });
  });

  it('places newly added card without colliding with existing cards', () => {
    const existing: PlacedCard[] = [
      { position: { x: 0, y: 0 }, variant: 'compact' },
      { position: { x: 0, y: 310 }, variant: 'wide' },
      { position: { x: 376, y: 0 }, variant: 'tall' },
    ];
    const newSlot = findBestSquareSlot('standard', existing);
    const newRect = cardBounds(newSlot, 'standard');
    for (const card of existing) {
      const existingRect = cardBounds(card.position, card.variant);
      expect(rectsOverlap(newRect, existingRect, 10)).toBe(false);
    }
  });

  it('favors slots that preserve a compact aspect ratio over linear expansion', () => {
    // 3 cards laid horizontally in a row
    const existing: PlacedCard[] = [
      { position: { x: 0, y: 0 }, variant: 'standard' },
      { position: { x: 376, y: 0 }, variant: 'standard' },
      { position: { x: 752, y: 0 }, variant: 'standard' },
    ];
    const newSlot = findBestSquareSlot('standard', existing);
    const newRect = cardBounds(newSlot, 'standard');

    // Should NOT collide
    for (const card of existing) {
      const existingRect = cardBounds(card.position, card.variant);
      expect(rectsOverlap(newRect, existingRect, 10)).toBe(false);
    }

    // Rather than continuing horizontally at x >= 1100, it should balance vertically
    expect(newSlot.y).not.toBe(0);
    const combined = contentBounds([...existing, { position: newSlot, variant: 'standard' }]);
    expect(Math.abs(combined.width - combined.height)).toBeLessThan(1200);
  });

  it('adapts around custom user-dragged card coordinates', () => {
    const dragged: PlacedCard[] = [
      { position: { x: 250, y: 150 }, variant: 'tall' },
      { position: { x: -100, y: -50 }, variant: 'compact' },
    ];
    const slot = findBestSquareSlot('wide', dragged);
    const slotRect = cardBounds(slot, 'wide');

    for (const card of dragged) {
      const existingRect = cardBounds(card.position, card.variant);
      expect(rectsOverlap(slotRect, existingRect, 10)).toBe(false);
    }
  });
});
