import { describe, expect, it } from 'vitest';
import {
  BOARD_COLUMNS,
  BOARD_GRID_ORIGIN,
  CARD_FIT_HEIGHT,
  CARD_WIDTH,
  EMPTY_BOARD_BOUNDS,
  contentBounds,
  defaultCardPosition,
  getCardVariant,
  tiledCardPosition,
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
});
