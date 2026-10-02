import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  fitViewport,
  panViewport,
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
});
