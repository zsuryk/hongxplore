import { describe, expect, it } from 'vitest';
import {
  BOARD_COLUMNS,
  BOARD_GRID_ORIGIN,
  CARD_FIT_HEIGHT,
  CARD_WIDTH,
  EMPTY_BOARD_BOUNDS,
  areAnyCardsOutOfFrame,
  autoTileBoard,
  calculateContentCardHeight,
  cardBounds,
  computeBoardLayout,
  contentBounds,
  defaultCardPosition,
  findBestSquareSlot,
  getActivityMatchingSlotId,
  getAutoTileColumnCount,
  getCardVariant,
  getCardVariantFromContent,
  getClustersPerRow,
  rectsOverlap,
  tiledCardPosition,
  type ActivityMatch,
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

describe('content-driven card shapes and pure board layout (Issue #76)', () => {
  const makeMockCard = (id: string, rationale: string, tags: string[] = ['culture']): ActivityMatch => ({
    activity: {
      id,
      title: `Activity ${id}`,
      title_en: `Activity ${id} EN`,
      tags,
    },
    match_rationale: rationale,
  });

  it('guarantees that two cards with equal content share the exact same shape', () => {
    const cardA = makeMockCard('card-a', 'Identical short rationale for culture', ['museum']);
    const cardB = makeMockCard('card-b', 'Identical short rationale for culture', ['museum']);

    expect(getCardVariantFromContent(cardA)).toBe(getCardVariantFromContent(cardB));
    expect(getCardVariant(cardA)).toBe(getCardVariant(cardB));
  });

  it('assigns compact, wide, or tall based on content density', () => {
    const shortCard = makeMockCard('short', 'Short rationale');
    const mediumCard = makeMockCard(
      'med',
      'Medium rationale that has moderate details and explanation for this activity',
      ['fun', 'weekend'],
    );
    const longCard = makeMockCard(
      'long',
      'Extremely long and comprehensive rationale explaining why this activity is uniquely matched to the weekend slot with all sorts of details and specifics.',
      ['culture', 'food', 'market', 'history', 'photography'],
    );

    expect(getCardVariantFromContent(shortCard)).toBe('compact');
    expect(getCardVariantFromContent(mediumCard)).toBe('wide');
    expect(getCardVariantFromContent(longCard)).toBe('tall');
  });

  describe('pure board layout across dock, undock, add, and remove', () => {
    const initialCards: ActivityMatch[] = [
      makeMockCard('c0', 'Rationale 0'),
      makeMockCard('c1', 'Rationale 1 with extra details', ['a', 'b', 'c']),
      makeMockCard('c2', 'Very long rationale 2 with a lot of words to explain the match thoroughly', [
        'x',
        'y',
        'z',
        'w',
      ]),
      makeMockCard('c3', 'Rationale 3'),
      makeMockCard('c4', 'Rationale 4'),
      makeMockCard('c5', 'Rationale 5'),
    ];

    it('preserves place and shape of every card when another card docks into timeline', () => {
      const initialLayout = computeBoardLayout({ cards: initialCards });

      const c1OriginalPos = initialLayout.positionsById['c1'];
      const c1OriginalVariant = initialLayout.variantsById['c1'];
      const c2OriginalPos = initialLayout.positionsById['c2'];
      const c2OriginalVariant = initialLayout.variantsById['c2'];

      expect(initialLayout.canvasCards.map((c) => c.card.activity.id)).toContain('c0');

      // Dock c0 into timeline
      const layoutAfterDock = computeBoardLayout({
        cards: initialCards,
        dockedCardIds: ['c0'],
        assignedPositions: initialLayout.positionsById,
      });

      // c0 is no longer on the canvas
      expect(layoutAfterDock.canvasCards.map((c) => c.card.activity.id)).not.toContain('c0');

      // c1, c2, c3, c4, c5 must keep their EXACT same positions and shapes
      expect(layoutAfterDock.positionsById['c1']).toEqual(c1OriginalPos);
      expect(layoutAfterDock.variantsById['c1']).toBe(c1OriginalVariant);
      expect(layoutAfterDock.positionsById['c2']).toEqual(c2OriginalPos);
      expect(layoutAfterDock.variantsById['c2']).toBe(c2OriginalVariant);

      const c1CanvasCard = layoutAfterDock.canvasCards.find((c) => c.card.activity.id === 'c1');
      expect(c1CanvasCard?.position).toEqual(c1OriginalPos);
      expect(c1CanvasCard?.variant).toBe(c1OriginalVariant);
    });

    it('preserves place and shape of every card when a docked card is undocked', () => {
      const initialLayout = computeBoardLayout({ cards: initialCards });
      const c0OriginalPos = initialLayout.positionsById['c0'];
      const c1OriginalPos = initialLayout.positionsById['c1'];

      // Dock c0
      const dockedLayout = computeBoardLayout({
        cards: initialCards,
        dockedCardIds: ['c0'],
        assignedPositions: initialLayout.positionsById,
      });

      // Undock c0
      const undockedLayout = computeBoardLayout({
        cards: initialCards,
        dockedCardIds: [],
        assignedPositions: dockedLayout.positionsById,
      });

      expect(undockedLayout.canvasCards.map((c) => c.card.activity.id)).toContain('c0');
      expect(undockedLayout.positionsById['c0']).toEqual(c0OriginalPos);
      expect(undockedLayout.positionsById['c1']).toEqual(c1OriginalPos);
    });

    it('preserves existing cards when a new card is added', () => {
      const initialLayout = computeBoardLayout({ cards: initialCards });
      const newCard = makeMockCard('c6', 'Brand new arriving card');

      const afterAddLayout = computeBoardLayout({
        cards: [...initialCards, newCard],
        assignedPositions: initialLayout.positionsById,
      });

      // All initial cards retain their exact positions and variants
      for (const card of initialCards) {
        expect(afterAddLayout.positionsById[card.activity.id]).toEqual(initialLayout.positionsById[card.activity.id]);
        expect(afterAddLayout.variantsById[card.activity.id]).toBe(initialLayout.variantsById[card.activity.id]);
      }

      // New card gets placed in an available slot
      expect(afterAddLayout.positionsById['c6']).toBeDefined();
    });

    it('preserves remaining cards when a card is removed (discarded)', () => {
      const initialLayout = computeBoardLayout({ cards: initialCards });
      const c1Pos = initialLayout.positionsById['c1'];
      const c2Pos = initialLayout.positionsById['c2'];

      // Discard c0
      const afterDiscardLayout = computeBoardLayout({
        cards: initialCards.filter((c) => c.activity.id !== 'c0'),
        discardedCards: [initialCards[0]],
        assignedPositions: initialLayout.positionsById,
      });

      expect(afterDiscardLayout.canvasCards.map((c) => c.card.activity.id)).not.toContain('c0');
      expect(afterDiscardLayout.positionsById['c1']).toEqual(c1Pos);
      expect(afterDiscardLayout.positionsById['c2']).toEqual(c2Pos);
    });

    it('re-running an identical search produces identical layout with zero displacement', () => {
      const firstRun = computeBoardLayout({ cards: initialCards });
      const secondRun = computeBoardLayout({
        cards: [...initialCards],
        assignedPositions: firstRun.positionsById,
      });

      expect(secondRun.positionsById).toEqual(firstRun.positionsById);
      expect(secondRun.variantsById).toEqual(firstRun.variantsById);
    });
  });

  describe('content-driven heights and measured collision avoidance', () => {
    it('calculates content-driven height so a 2-line rationale is shorter than a 6-line rationale', () => {
      const shortRationaleCard = makeMockCard('short-c', 'Brief 2-line rationale match for testing.');
      const longRationaleCard = makeMockCard(
        'long-c',
        'This is a comprehensive six-line rationale with detailed explanation about cultural background, neighborhood walking convenience, timing, language comfort, and unique architectural interest in the historic quarter.',
      );

      const shortHeight = calculateContentCardHeight(shortRationaleCard, 'standard');
      const longHeight = calculateContentCardHeight(longRationaleCard, 'standard');

      expect(shortHeight).toBeLessThan(longHeight);
      expect(shortHeight).toBeGreaterThanOrEqual(280);
    });

    it('tiledCardPosition accommodates tall compact card so wide card clears it', () => {
      const standardCompactPos = tiledCardPosition(1, undefined, 250);
      const tallCompactPos = tiledCardPosition(1, undefined, 350);

      expect(standardCompactPos.y).toBe(BOARD_GRID_ORIGIN.y + 310);
      // Tall compact card (350px) pushes wide card down to 350 + 40 = 390
      expect(tallCompactPos.y).toBe(BOARD_GRID_ORIGIN.y + 390);
    });

    it('findBestSquareSlot uses measured height to avoid candidate collision', () => {
      // Existing card has a measured height of 500px at (0, 0)
      const existing: PlacedCard[] = [
        {
          position: { x: 0, y: 0 },
          variant: 'tall',
          width: 320,
          height: 500,
        },
      ];

      // A slot candidate placed below it must clear 500px, not the default fitHeight (480px)
      const slot = findBestSquareSlot('standard', existing, { x: 0, y: 0 }, 300);
      const slotRect = cardBounds(slot, 'standard', 300);
      const existingRect = cardBounds(existing[0].position, existing[0].variant, existing[0].height);

      expect(rectsOverlap(slotRect, existingRect, 10)).toBe(false);
    });

    it('computeBoardLayout exposes height and passes it to contentBounds and placed cards', () => {
      const cards: ActivityMatch[] = [
        makeMockCard('c0', 'Short rationale'),
        makeMockCard(
          'c1',
          'Very detailed rationale that expands across multiple lines and takes more vertical space on the canvas.',
        ),
      ];

      const measuredHeights = {
        c0: 240,
        c1: 420,
      };

      const layout = computeBoardLayout({ cards, measuredHeights });

      expect(layout.heightsById['c0']).toBe(240);
      expect(layout.heightsById['c1']).toBe(420);
      expect(layout.canvasCards[0].height).toBe(240);
      expect(layout.canvasCards[1].height).toBe(420);

      // contentBounds uses the cards' measured heights
      const bounds = contentBounds(layout.canvasCards);
      expect(bounds.height).toBeGreaterThanOrEqual(420);
    });
  });

  describe('autoTileBoard', () => {
    it('returns an empty mapping when the board is empty', () => {
      expect(autoTileBoard([])).toEqual({});
    });

    it('places a single card at the grid origin', () => {
      const singleCard = { id: 'only-card', height: 350 };
      const positions = autoTileBoard([singleCard]);

      expect(positions).toEqual({
        'only-card': BOARD_GRID_ORIGIN,
      });
    });

    it('is strictly deterministic: identical cards produce identical layout', () => {
      const cards = [
        makeMockCard('c0', 'Rationale 0'),
        makeMockCard('c1', 'Rationale 1'),
        makeMockCard('c2', 'Rationale 2'),
        makeMockCard('c3', 'Rationale 3'),
      ];

      const run1 = autoTileBoard(cards);
      const run2 = autoTileBoard(cards);

      expect(run1).toEqual(run2);
      expect(Object.keys(run1)).toHaveLength(4);
    });

    it('positions cards with mixed variable heights without overlaps', () => {
      const mixedCards = [
        { id: 'short-1', height: 210 },
        { id: 'tall-1', height: 520 },
        { id: 'medium-1', height: 340 },
        { id: 'tall-2', height: 480 },
        { id: 'short-2', height: 230 },
        { id: 'medium-2', height: 360 },
      ];

      const positions = autoTileBoard(mixedCards);
      const placedRects = mixedCards.map((c) => cardBounds(positions[c.id], 'standard', c.height));

      // Assert zero pairwise overlap with margin
      for (let i = 0; i < placedRects.length; i++) {
        for (let j = i + 1; j < placedRects.length; j++) {
          expect(rectsOverlap(placedRects[i], placedRects[j])).toBe(false);
        }
      }
    });

    it('guarantees zero overlap between any two cards across the entire board', () => {
      const variedCards = Array.from({ length: 9 }, (_, index) => ({
        id: `card-${index}`,
        height: 200 + (index % 4) * 90, // heights: 200, 290, 380, 470...
      }));

      const positions = autoTileBoard(variedCards);
      const boundsList = variedCards.map((c) => cardBounds(positions[c.id], 'standard', c.height));

      for (let i = 0; i < boundsList.length; i++) {
        for (let j = i + 1; j < boundsList.length; j++) {
          const overlap = rectsOverlap(boundsList[i], boundsList[j]);
          expect(overlap).toBe(false);
        }
      }
    });

    it('yields a tight, roughly square board rather than a sparse scatter', () => {
      const cards = Array.from({ length: 6 }, (_, index) => ({
        id: `c-${index}`,
        height: 350,
      }));

      const positions = autoTileBoard(cards);
      const placed = cards.map((c) => ({
        position: positions[c.id],
        height: c.height,
        width: CARD_WIDTH,
      }));

      const bounds = contentBounds(placed);
      const aspectRatio = bounds.width / bounds.height;

      // With 6 cards packed in 3 columns x 2 rows, ratio is ~1.4, well within balanced square bounds [0.7, 1.6]
      expect(aspectRatio).toBeGreaterThan(0.7);
      expect(aspectRatio).toBeLessThan(1.7);
      expect(getAutoTileColumnCount(6)).toBe(3);
    });

    it('handles cards with very different heights correctly', () => {
      const veryDifferentCards = [
        { id: 'tiny', height: 180 },
        { id: 'giant', height: 600 },
        { id: 'mid', height: 320 },
        { id: 'huge', height: 550 },
      ];

      const positions = autoTileBoard(veryDifferentCards);

      // In column 0: tiny (height 180) -> mid should be placed cleanly below tiny
      // tiny at origin.y, mid at origin.y + 180 + gap
      expect(positions['mid'].y).toBe(BOARD_GRID_ORIGIN.y + 180 + 40);
      // In column 1: giant (height 600) -> huge should be placed below giant
      expect(positions['huge'].y).toBe(BOARD_GRID_ORIGIN.y + 600 + 40);

      // Pairwise overlap check
      const rects = veryDifferentCards.map((c) => cardBounds(positions[c.id], 'standard', c.height));
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          expect(rectsOverlap(rects[i], rects[j])).toBe(false);
        }
      }
    });
  });
});
