/** ALL user-facing UI strings live here (English v1). Never inline strings in components. */

export const BOARD_LABEL = 'Weekend plan board';
export const BOARD_GUIDE_TITLE = 'Your weekend plan starts here';
export const BOARD_GUIDE_BODY = 'Pan the board, zoom in and out, or fit the view.';
export const ZOOM_IN_LABEL = 'Zoom in';
export const ZOOM_OUT_LABEL = 'Zoom out';
export const FIT_VIEW_LABEL = 'Fit board to content';
export const ZOOM_CONTROL_LABEL = 'Viewport controls';

export function zoomPercentage(value: number): string {
  return `Zoom: ${Math.round(value * 100)}%`;
}

export const HEADING = 'Hongxplore — scaffold';
export const TAGLINE = 'Infinite whiteboard + AI activity agent for students in Hong Kong.';
