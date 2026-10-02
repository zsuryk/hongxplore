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

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2.5;

export const initialViewport: Viewport = {
  x: 0,
  y: 0,
  scale: 1,
};

export function clampZoom(scale: number): number {
  return Math.min(Math.max(scale, MIN_ZOOM), MAX_ZOOM);
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

export function fitViewport(content: Rect, container: Rect, padding: number): Viewport {
  const availableWidth = Math.max(container.width - padding * 2, 1);
  const availableHeight = Math.max(container.height - padding * 2, 1);
  const scale = clampZoom(Math.min(availableWidth / content.width, availableHeight / content.height));

  return {
    scale,
    x: container.x + (container.width - content.width * scale) / 2 - content.x * scale,
    y: container.y + (container.height - content.height * scale) / 2 - content.y * scale,
  };
}
