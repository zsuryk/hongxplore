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
export function fitViewport(content: Rect, container: Rect, padding: number, maxScale: number = 1.0): Viewport {
  if (content.width <= 0 || content.height <= 0) {
    return { scale: 1, x: 0, y: 0 };
  }

  const availableWidth = Math.max(container.width - padding * 2, 1);
  const availableHeight = Math.max(container.height - padding * 2, 1);
  const scale = clampZoom(
    Math.min(availableWidth / content.width, availableHeight / content.height),
    FIT_MIN_ZOOM,
    maxScale,
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

/**
 * Tests whether `rect` (in world coordinates) is completely visible within the screen
 * container at the given `viewport`, leaving at least `padding` pixels of breathing room.
 */
export function isRectInViewport(
  rect: Rect,
  viewport: Viewport,
  container: { width: number; height: number },
  padding: number = 24,
): boolean {
  if (container.width <= 0 || container.height <= 0) {
    return true;
  }

  const screenLeft = rect.x * viewport.scale + viewport.x;
  const screenTop = rect.y * viewport.scale + viewport.y;
  const screenRight = (rect.x + rect.width) * viewport.scale + viewport.x;
  const screenBottom = (rect.y + rect.height) * viewport.scale + viewport.y;

  return (
    screenLeft >= padding &&
    screenTop >= padding &&
    screenRight <= container.width - padding &&
    screenBottom <= container.height - padding
  );
}

/** Top chrome exclusion zone (toolbar, search bar, status panel) in screen px. */
export const SAFE_TOP_CHROME = 56;

/** Bottom dock exclusion zone (timeline dock + safe breathing room) in screen px. */
export const SAFE_BOTTOM_DOCK = 104;

/** Horizontal safe padding from screen edges in screen px. */
export const SAFE_HORIZONTAL_PADDING = 32;

/** Inner breathing room so framed card never touches safe boundaries. */
export const SAFE_CARD_PADDING = 16;

/**
 * Smart-centers the viewport to frame active content cleanly at 100% (or safe scale).
 *
 * 1. Safe clearance: Accounts for top chrome (56px) and bottom timeline dock (104px)
 *    so the card is NEVER clipped or buried underneath the timeline dock.
 * 2. Full card framing: If the card at 1.0 exceeds safe viewport height (e.g. on compact
 *    laptops with tall cards), automatically scales to fit so 100% of the card is visible
 *    from header plate down to the booking CTA button.
 * 3. Focal preservation: If the user is already looking at a card that is completely visible
 *    in the safe area, maintains existing focal point with zero camera jump.
 * 4. Snapping: When jumping from an overview or landing in empty space / partially occluded card,
 *    snaps the focus to the nearest card medoid, perfectly framed in the safe viewing area.
 */
export function smartCenter100(
  currentViewport: Viewport,
  cards: readonly Rect[] | null | undefined,
  container: { width: number; height: number },
): Viewport {
  const containerW = container.width;
  const containerH = container.height;
  const screenCenter = { x: containerW / 2 || 0, y: containerH / 2 || 0 };

  if (!cards || cards.length === 0 || containerW <= 0 || containerH <= 0) {
    return zoomAtScreenPoint(currentViewport, screenCenter, 1.0);
  }

  const currentWorldCenter = screenToWorld(screenCenter, currentViewport);

  // Check if current center already falls within any card's bounds
  const cardUnderCenter = cards.find(
    (card) =>
      currentWorldCenter.x >= card.x &&
      currentWorldCenter.x <= card.x + card.width &&
      currentWorldCenter.y >= card.y &&
      currentWorldCenter.y <= card.y + card.height,
  );

  // Select target card: the card under center, or nearest card (medoid)
  let targetCard = cardUnderCenter;
  if (!targetCard) {
    let minDistanceSq = Infinity;
    targetCard = cards[0];
    for (const card of cards) {
      const cardCenterX = card.x + card.width / 2;
      const cardCenterY = card.y + card.height / 2;
      const dx = cardCenterX - currentWorldCenter.x;
      const dy = cardCenterY - currentWorldCenter.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < minDistanceSq) {
        minDistanceSq = distSq;
        targetCard = card;
      }
    }
  }

  // Calculate safe viewport dimensions excluding top chrome, bottom dock, and inner padding
  const safeWidth = Math.max(containerW - SAFE_HORIZONTAL_PADDING * 2 - SAFE_CARD_PADDING * 2, 1);
  const safeHeight = Math.max(containerH - SAFE_TOP_CHROME - SAFE_BOTTOM_DOCK - SAFE_CARD_PADDING * 2, 1);

  // Scale: 1.0 by default, but if card exceeds safe area on smaller screens, scale down to fit cleanly
  const fitScale = Math.min(safeWidth / targetCard.width, safeHeight / targetCard.height);
  const targetScale = clampZoom(Math.min(1.0, fitScale), FIT_MIN_ZOOM, 1.0);

  const isSubtleZoom = Math.abs(currentViewport.scale - targetScale) <= 0.25;

  // Subtle zoom adjustments (e.g. within ±25%) preserve the user's existing focal point
  if (isSubtleZoom) {
    return zoomAtScreenPoint(currentViewport, screenCenter, targetScale);
  }

  // Jumping from an overview into empty space: frame target card centered in container
  // and safe viewing area with top chrome and bottom timeline dock clearance
  const targetX = (containerW - targetCard.width * targetScale) / 2 - targetCard.x * targetScale;
  const targetY =
    SAFE_TOP_CHROME +
    SAFE_CARD_PADDING +
    (safeHeight - targetCard.height * targetScale) / 2 -
    targetCard.y * targetScale;

  return {
    scale: targetScale,
    x: targetX,
    y: targetY,
  };
}
