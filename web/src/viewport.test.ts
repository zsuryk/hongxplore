import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_LEVELS,
  SAFE_BOTTOM_DOCK,
  SAFE_TOP_CHROME,
  canZoomIn,
  canZoomOut,
  fitViewport,
  isRectInViewport,
  nextZoomLevel,
  panViewport,
  preserveViewportCenter,
  screenToWorld,
  smartCenter100,
  worldToScreen,
  zoomAtScreenPoint,
} from './viewport';

describe('viewport transforms', () => {
  const viewport = { x: 120, y: -48, scale: 1.5 };

  it('converts between world and screen coordinates', () => {
    const worldPoint = { x: -40, y: 96 };

    expect(screenToWorld(worldToScreen(worldPoint, viewport), viewport)).toEqual(worldPoint);
  });

  it('pans without changing the zoom level', () => {
    expect(panViewport(viewport, { x: 24, y: -12 })).toEqual({ x: 144, y: -60, scale: 1.5 });
  });

  it('keeps the world point below the cursor fixed while zooming', () => {
    const cursor = { x: 300, y: 240 };
    const zoomedViewport = zoomAtScreenPoint(viewport, cursor, 2);

    expect(screenToWorld(cursor, zoomedViewport)).toEqual(screenToWorld(cursor, viewport));
  });

  it('clamps zoom to the supported range', () => {
    expect(zoomAtScreenPoint(viewport, { x: 0, y: 0 }, 100).scale).toBe(MAX_ZOOM);
    expect(zoomAtScreenPoint(viewport, { x: 0, y: 0 }, 0.01).scale).toBe(MIN_ZOOM);
  });

  it('centres content when fitting the view', () => {
    const content = { x: -100, y: -50, width: 200, height: 100 };
    const container = { x: 0, y: 0, width: 800, height: 600 };
    const fittedViewport = fitViewport(content, container, 40);

    expect(worldToScreen({ x: 0, y: 0 }, fittedViewport)).toEqual({ x: 400, y: 300 });
  });

  it('scales below the gesture minimum when fitting would otherwise not fit', () => {
    const content = { x: 0, y: 0, width: 4000, height: 1000 };
    const container = { x: 0, y: 0, width: 800, height: 600 };
    const fittedViewport = fitViewport(content, container, 40);

    expect(fittedViewport.scale).toBeLessThan(MIN_ZOOM);
    expect(content.width * fittedViewport.scale).toBeLessThanOrEqual(container.width);
  });

  it('keeps the centre point when the board is resized', () => {
    const oldCentre = { x: 400, y: 300 };
    const newCentre = { x: 500, y: 250 };
    const resized = preserveViewportCenter(viewport, { width: 800, height: 600 }, { width: 1000, height: 500 });

    // The world point framed by the old board centre is framed by the new one.
    expect(screenToWorld(newCentre, resized)).toEqual(screenToWorld(oldCentre, viewport));
  });
});

describe('zoom ladder', () => {
  it('only lands on declared levels', () => {
    for (const level of ZOOM_LEVELS) {
      expect(ZOOM_LEVELS).toContain(nextZoomLevel(level - 0.01, 1));
      expect(ZOOM_LEVELS).toContain(nextZoomLevel(level + 0.01, -1));
    }
  });

  it('steps up and down without skipping or looping', () => {
    expect(nextZoomLevel(1, 1)).toBe(1.25);
    expect(nextZoomLevel(1.25, -1)).toBe(1);
    expect(nextZoomLevel(0.9, 1)).toBe(1);
    expect(nextZoomLevel(0.9, -1)).toBe(0.8);
  });

  it('stops at the ends of the ladder', () => {
    expect(nextZoomLevel(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(nextZoomLevel(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });

  it('reports when the ends have been reached', () => {
    expect(canZoomIn(MAX_ZOOM)).toBe(false);
    expect(canZoomIn(1)).toBe(true);
    expect(canZoomOut(MIN_ZOOM)).toBe(false);
    expect(canZoomOut(1)).toBe(true);
  });

  it('determines if a rect is visible in viewport frame with padding', () => {
    const vp = { x: 0, y: 0, scale: 1 };
    const container = { width: 1000, height: 800 };

    expect(isRectInViewport({ x: 100, y: 100, width: 200, height: 200 }, vp, container, 24)).toBe(true);
    expect(isRectInViewport({ x: 900, y: 100, width: 200, height: 200 }, vp, container, 24)).toBe(false);
    expect(isRectInViewport({ x: -50, y: 100, width: 200, height: 200 }, vp, container, 24)).toBe(false);
    expect(isRectInViewport({ x: 10, y: 10, width: 100, height: 100 }, vp, container, 24)).toBe(false);
  });
});

describe('smartCenter100 (#104)', () => {
  const container = { width: 1000, height: 700 };
  const overviewViewport = { x: 50, y: 50, scale: 0.4 };

  const cards = [
    { x: 100, y: 100, width: 320, height: 200 }, // Card 1 center: (260, 200)
    { x: 460, y: 100, width: 320, height: 200 }, // Card 2 center: (620, 200)
    { x: 100, y: 340, width: 320, height: 200 }, // Card 3 center: (260, 440)
    { x: 460, y: 340, width: 320, height: 200 }, // Card 4 center: (620, 440)
  ];

  it('resets to 100% at container center when no cards exist', () => {
    const result = smartCenter100(overviewViewport, [], container);
    expect(result.scale).toBe(1.0);
    expect(worldToScreen(screenToWorld({ x: 500, y: 350 }, result), result)).toEqual({ x: 500, y: 350 });
  });

  it('preserves existing focal point with zero camera jump for subtle zoom changes', () => {
    const subtleViewport = { x: 120, y: -40, scale: 0.9 };
    const result = smartCenter100(subtleViewport, cards, container);

    expect(result.scale).toBe(1.0);
    // World point at screen center should remain at screen center
    const centerBefore = screenToWorld({ x: 500, y: 350 }, subtleViewport);
    const centerAfter = screenToWorld({ x: 500, y: 350 }, result);
    expect(centerAfter.x).toBeCloseTo(centerBefore.x, 2);
    expect(centerAfter.y).toBeCloseTo(centerBefore.y, 2);
  });

  it('preserves focal point when screen center is already directly over a card', () => {
    // Viewport positioned so screen center (500, 350) lands inside Card 1 (100..420, 100..300)
    const cardCenteredViewport = { x: 300, y: 150, scale: 1.0 };
    const result = smartCenter100(cardCenteredViewport, cards, container);

    expect(result.scale).toBe(1.0);
    expect(result.x).toBe(cardCenteredViewport.x);
    expect(result.y).toBe(cardCenteredViewport.y);
  });

  it('snaps to nearest card medoid and frames in safe viewing area when jumping from overview', () => {
    // Overview viewport where screen center (500, 350) lands in the empty gap (430, 250)
    // Between Card 1 center (260, 200) and Card 2 center (620, 200)
    // Distance to Card 4 is sqrt((620-500)^2 + (440-350)^2) = 150 (nearest card)
    const gapViewport = { x: -20, y: 50, scale: 0.4 };
    const result = smartCenter100(gapViewport, cards, container);

    expect(result.scale).toBe(1.0);
    // Card 4 should be horizontally centered
    const worldCenter = screenToWorld({ x: 500, y: 350 }, result);
    expect(worldCenter.x).toBeCloseTo(620, 1);

    // Card 4 must be completely visible with clearance from top chrome and bottom timeline dock
    const card4ScreenTop = 340 * result.scale + result.y;
    const card4ScreenBottom = (340 + 200) * result.scale + result.y;
    expect(card4ScreenTop).toBeGreaterThanOrEqual(SAFE_TOP_CHROME);
    expect(card4ScreenBottom).toBeLessThanOrEqual(container.height - SAFE_BOTTOM_DOCK);
  });

  it('automatically fits tall cards on compact laptop screens without clipping', () => {
    // Compact laptop screen: 1024x580
    const compactContainer = { width: 1024, height: 580 };
    // Full detail card: 320x460 (would exceed safe area at 1.0)
    const tallCard = [{ x: 200, y: 200, width: 320, height: 460 }];
    const overview = { x: 0, y: 0, scale: 0.35 };

    const result = smartCenter100(overview, tallCard, compactContainer);

    // Scale should safely scale down so the full card fits inside safe area
    expect(result.scale).toBeLessThanOrEqual(1.0);
    expect(result.scale).toBeGreaterThan(0.5);

    const screenTop = 200 * result.scale + result.y;
    const screenBottom = (200 + 460) * result.scale + result.y;
    expect(screenTop).toBeGreaterThanOrEqual(SAFE_TOP_CHROME);
    expect(screenBottom).toBeLessThanOrEqual(compactContainer.height - SAFE_BOTTOM_DOCK);
  });
});
