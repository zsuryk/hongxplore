import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_LEVELS,
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
  const currentViewport = { x: 50, y: 50, scale: 0.4 };

  it('resets to 100% at container center when no content exists', () => {
    const result = smartCenter100(currentViewport, null, container, 48);
    expect(result.scale).toBe(1.0);
    // At scale 1, screen center remains centered
    expect(worldToScreen(screenToWorld({ x: 500, y: 350 }, result), result)).toEqual({ x: 500, y: 350 });
  });

  it('centers content horizontally and vertically when content fits within container at 100%', () => {
    const content = { x: 100, y: 200, width: 400, height: 300 };
    const result = smartCenter100(currentViewport, content, container, 48);

    expect(result.scale).toBe(1.0);
    // Expected center:
    // x = (1000 - 400)/2 - 100 = 200
    // y = (700 - 300)/2 - 200 = 0
    expect(result.x).toBe(200);
    expect(result.y).toBe(0);

    // Screen coordinates of content bounds should have equal margins:
    const screenLeft = content.x * result.scale + result.x;
    const screenRight = (content.x + content.width) * result.scale + result.x;
    expect(screenLeft).toBe(300);
    expect(container.width - screenRight).toBe(300);
  });

  it('aligns to top margin when content is taller than viewport and zoomed out, preventing void center', () => {
    // 12 cards in 2 columns: 1400px tall
    const content = { x: 150, y: 100, width: 660, height: 1400 };
    const result = smartCenter100(currentViewport, content, container, 48);

    expect(result.scale).toBe(1.0);
    // Fits horizontally -> centered horizontally: (1000 - 660)/2 - 150 = 20
    expect(result.x).toBe(20);
    // Taller than viewport (1400 > 700 - 96) -> aligns top with padding (48):
    // y = padding - content.y = 48 - 100 = -52
    expect(result.y).toBe(-52);

    // Screen top of the first card should be at padding (48px), perfectly visible:
    const screenTop = content.y * result.scale + result.y;
    expect(screenTop).toBe(48);
  });

  it('clamps within content bounds when already zoomed in and examining cards', () => {
    const content = { x: 0, y: 0, width: 1500, height: 1500 };
    const zoomedInViewport = { x: -800, y: -800, scale: 1.25 };
    const result = smartCenter100(zoomedInViewport, content, container, 48);

    expect(result.scale).toBe(1.0);
    // Content should not be panned beyond content bounds
    const screenLeft = content.x * result.scale + result.x;
    const screenTop = content.y * result.scale + result.y;
    const screenRight = (content.x + content.width) * result.scale + result.x;
    const screenBottom = (content.y + content.height) * result.scale + result.y;

    expect(screenLeft).toBeLessThanOrEqual(48);
    expect(screenTop).toBeLessThanOrEqual(48);
    expect(screenRight).toBeGreaterThanOrEqual(container.width - 48);
    expect(screenBottom).toBeGreaterThanOrEqual(container.height - 48);
  });
});
