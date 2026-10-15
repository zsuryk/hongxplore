import {
  TOUR_CARD_BODY,
  TOUR_CARD_TITLE,
  TOUR_SEARCH_BODY,
  TOUR_SEARCH_TITLE,
  TOUR_TIMELINE_BODY,
  TOUR_TIMELINE_TITLE,
  TOUR_TOOLBAR_BODY,
  TOUR_TOOLBAR_TITLE,
} from './copy';

export type ProductTourStep = {
  id: string;
  anchorSelector: string;
  fallbackSelector?: string;
  title: string;
  body: string;
  placement: 'bottom' | 'adjacent' | 'top' | 'left';
};

export const TOUR_STEPS: ProductTourStep[] = [
  {
    id: 'search',
    anchorSelector: '[data-tour-anchor="search"]',
    fallbackSelector: '.search-bar',
    title: TOUR_SEARCH_TITLE,
    body: TOUR_SEARCH_BODY,
    placement: 'bottom',
  },
  {
    id: 'card',
    anchorSelector: '[data-tour-anchor="card"]',
    fallbackSelector: '.activity-card',
    title: TOUR_CARD_TITLE,
    body: TOUR_CARD_BODY,
    placement: 'adjacent',
  },
  {
    id: 'timeline',
    anchorSelector: '[data-tour-anchor="timeline"]',
    fallbackSelector: '.timeline',
    title: TOUR_TIMELINE_TITLE,
    body: TOUR_TIMELINE_BODY,
    placement: 'top',
  },
  {
    id: 'toolbar',
    anchorSelector: '[data-tour-anchor="toolbar"]',
    fallbackSelector: '.board-toolbar',
    title: TOUR_TOOLBAR_TITLE,
    body: TOUR_TOOLBAR_BODY,
    placement: 'left',
  },
];

export type CardCoords = {
  top: number;
  left: number;
  targetRect: DOMRect | null;
};

export const CARD_WIDTH = 320;
export const CARD_HEIGHT = 180;
export const MARGIN = 16;
export const TOP_CHROME = 56;
export const BOTTOM_DOCK = 80;

export function fallbackCoords(vw: number, vh: number): CardCoords {
  return {
    top: Math.max(TOP_CHROME + 20, Math.min(140, vh - CARD_HEIGHT - BOTTOM_DOCK)),
    left: Math.max(MARGIN, (vw - CARD_WIDTH) / 2),
    targetRect: null,
  };
}

export function computePlacement(step: ProductTourStep, vw: number, vh: number): CardCoords {
  if (typeof document === 'undefined') {
    return { top: 120, left: MARGIN, targetRect: null };
  }

  const target =
    document.querySelector(step.anchorSelector) ??
    (step.fallbackSelector ? document.querySelector(step.fallbackSelector) : null);

  if (!target) {
    return fallbackCoords(vw, vh);
  }

  const rect = target.getBoundingClientRect();
  const isOffscreen =
    rect.width === 0 || rect.height === 0 || rect.bottom <= 0 || rect.top >= vh || rect.right <= 0 || rect.left >= vw;

  if (isOffscreen) {
    return fallbackCoords(vw, vh);
  }

  let top = 0;
  let left = 0;

  switch (step.placement) {
    case 'bottom': {
      top = rect.bottom + 12;
      left = rect.left + (rect.width - CARD_WIDTH) / 2;
      break;
    }
    case 'adjacent': {
      left = rect.right + 16;
      top = rect.top;
      if (left + CARD_WIDTH > vw - MARGIN) {
        // If placing on right overflows viewport, place below
        left = Math.max(MARGIN, rect.left);
        top = rect.bottom + 12;
      }
      break;
    }
    case 'top': {
      top = rect.top - CARD_HEIGHT - 16;
      left = rect.left + (rect.width - CARD_WIDTH) / 2;
      break;
    }
    case 'left': {
      left = rect.left - CARD_WIDTH - 16;
      top = rect.top + (rect.height - CARD_HEIGHT) / 2;
      break;
    }
  }

  // Clamp within viewport
  const maxLeft = Math.max(MARGIN, vw - CARD_WIDTH - MARGIN);
  const maxTop = Math.max(MARGIN, vh - CARD_HEIGHT - MARGIN);

  left = Math.max(MARGIN, Math.min(left, maxLeft));
  top = Math.max(TOP_CHROME, Math.min(top, maxTop));

  return { top, left, targetRect: rect };
}
