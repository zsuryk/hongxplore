import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_LEVELS,
  canZoomIn,
  canZoomOut,
  fitViewport,
  nextZoomLevel,
  panViewport,
  preserveViewportCenter,
  screenToWorld,
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
});
