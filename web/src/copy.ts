/** ALL user-facing UI strings live here (English v1). Never inline strings in components. */

export const BOARD_LABEL = 'Weekend plan board';
export const BOARD_GUIDE_TITLE = 'Your weekend plan starts here';
export const BOARD_GUIDE_BODY = 'Pan the board, zoom in and out, or fit the view.';
export const ZOOM_IN_LABEL = 'Zoom in';
export const ZOOM_OUT_LABEL = 'Zoom out';
export const FIT_VIEW_LABEL = 'Fit board to content';
export const ZOOM_CONTROL_LABEL = 'Viewport controls';
export const TIMELINE_LABEL = 'Weekend timeline';
export const TIMELINE_SLOT_EMPTY = 'Empty slot';
export const UNDOCK_CARD_LABEL = 'Remove from timeline';
export const TIMELINE_SLOTS = [
  { id: 'saturday-afternoon', label: 'Saturday afternoon' },
  { id: 'saturday-evening', label: 'Saturday evening' },
  { id: 'sunday-afternoon', label: 'Sunday afternoon' },
] as const;
export const ACTIVITY_CARD_LABEL = 'Activity card';
export const ACTIVITY_CARD_ORIGINAL_TITLE_LABEL = 'Original title';
export const ACTIVITY_CARD_LANGUAGE_LABEL = 'Language';
export const ACTIVITY_CARD_LANGUAGE_ENGLISH = 'English';
export const ACTIVITY_CARD_LANGUAGE_CHINESE = 'Chinese';
export const ACTIVITY_CARD_TIME_UNAVAILABLE = 'Time to be confirmed';
export const ACTIVITY_CARD_SOURCE_LABEL = 'Source';
export const ACTIVITY_CARD_MATCH_RATIONALE_LABEL = 'Why it matches';
export const FIND_SIMILAR_LABEL = 'Find similar';
export const DISCARD_BIN_LABEL = 'Discard bin';
export const DISCARD_BIN_HINT = 'Drop a card here to remove it from the board.';
export const BOARD_EMPTY_STATE = 'Your board is clear. Find similar activities to explore more.';
export const INITIAL_ACTIVITY_QUERY = 'free saturday afternoon, something cultural in Kowloon, English friendly';

export function activityCardAccessibleLabel(title: string): string {
  return `${ACTIVITY_CARD_LABEL}: ${title}`;
}

export function activityCardLocation(venue: string | null | undefined, district: string): string {
  return venue ? `${venue}, ${district}` : district;
}

export function findSimilarConfirmation(title: string): string {
  return `Looking for activities similar to ${title}.`;
}

export function zoomPercentage(value: number): string {
  return `Zoom: ${Math.round(value * 100)}%`;
}

export const HEADING = 'Hongxplore — scaffold';
export const TAGLINE = 'Infinite whiteboard + AI activity agent for students in Hong Kong.';
