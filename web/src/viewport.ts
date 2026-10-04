export type Point = {
  x: number;
  y: number;
};

export type Rect = Point & {
  width: number;
  height: number;
};

export type Viewport = {
  x: number;
  y: number;
  scale: number;
};

/** Continuous zoom bounds for wheel/pinch gestures. */
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 3;

/**
 * Discrete zoom ladder used by the toolbar buttons. Snapping to readable levels stops
 * the "+" button from landing on awkward scales like 137%.
 */
export const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3] as const;

/** `fitView` may go below `MIN_ZOOM` down to here, otherwise "fit" silently fails. */
export const FIT_MIN_ZOOM = 0.1;

/** Panning distance for one arrow-key press, in screen px. */
export const KEYBOARD_PAN_STEP = 64;
export const KEYBOARD_PAN_STEP_FAST = 256;

export const initialViewport: Viewport = {
  x: 0,
  y: 0,
  scale: 1,
};

export function clampZoom(scale: number, minZoom: number = MIN_ZOOM, maxZoom: number = MAX_ZOOM): number {
  return Math.min(Math.max(scale, minZoom), maxZoom);
}

export function screenToWorld(point: Point, viewport: Viewport): Point {
  return {
    x: (point.x - viewport.x) / viewport.scale,
    y: (point.y - viewport.y) / viewport.scale,
  };
}

export function worldToScreen(point: Point, viewport: Viewport): Point {
  return {
    x: point.x * viewport.scale + viewport.x,
    y: point.y * viewport.scale + viewport.y,
  };
}

export function panViewport(viewport: Viewport, delta: Point): Viewport {
  return {
    ...viewport,
    x: viewport.x + delta.x,
    y: viewport.y + delta.y,
  };
}

export function zoomAtScreenPoint(viewport: Viewport, screenPoint: Point, nextScale: number): Viewport {
  const scale = clampZoom(nextScale);
  const worldPoint = screenToWorld(screenPoint, viewport);

  return {
    scale,
    x: screenPoint.x - worldPoint.x * scale,
    y: screenPoint.y - worldPoint.y * scale,
  };
}

export function pinchViewport(
  viewport: Viewport,
  startScreenPoint: Point,
  currentScreenPoint: Point,
  scaleFactor: number,
): Viewport {
  const scale = clampZoom(viewport.scale * scaleFactor);
  const worldPoint = screenToWorld(startScreenPoint, viewport);

  return {
    scale,
    x: currentScreenPoint.x - worldPoint.x * scale,
    y: currentScreenPoint.y - worldPoint.y * scale,
  };
}

/** Zoom level the toolbar moves to from `scale`, walking `ZOOM_LEVELS`. */
export function nextZoomLevel(scale: number, direction: 1 | -1): number {
  const ordered = direction === 1 ? ZOOM_LEVELS : [...ZOOM_LEVELS].reverse();
  const next = ordered.find((level) => (direction === 1 ? level > scale + 0.001 : level < scale - 0.001));

  return next ?? scale;
}

export function canZoomIn(scale: number): boolean {
  return scale < MAX_ZOOM - 0.001;
}

export function canZoomOut(scale: number): boolean {
  return scale > MIN_ZOOM + 0.001;
}

/**
 * Frames `content` inside `container`. Unlike a plain zoom clamp this may scale below
 * `MIN_ZOOM` (down to `FIT_MIN_ZOOM`), because a fit that does not fit is a bug the
 * user cannot work around.
 */
export function fitViewport(content: Rect, container: Rect, padding: number): Viewport {
  const availableWidth = Math.max(container.width - padding * 2, 1);
  const availableHeight = Math.max(container.height - padding * 2, 1);
  const scale = clampZoom(
    Math.min(availableWidth / content.width, availableHeight / content.height),
    FIT_MIN_ZOOM,
    MAX_ZOOM,
  );

  return {
    scale,
    x: container.x + (container.width - content.width * scale) / 2 - content.x * scale,
    y: container.y + (container.height - content.height * scale) / 2 - content.y * scale,
  };
}

/**
 * Keeps the point at the middle of the old board at the middle of the new one. Used on
 * resize so a window change never throws away the user's pan and zoom.
 */
export function preserveViewportCenter(
  viewport: Viewport,
  previousSize: { width: number; height: number },
  nextSize: { width: number; height: number },
): Viewport {
  return panViewport(viewport, {
    x: (nextSize.width - previousSize.width) / 2,
    y: (nextSize.height - previousSize.height) / 2,
  });
}
