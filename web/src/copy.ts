/** ALL user-facing UI strings live here (English v1). Never inline strings in components. */

export const BOARD_LABEL = 'Weekend plan board';
export const BOARD_GUIDE_TITLE = 'Your weekend plan starts here';
export const BOARD_GUIDE_BODY = 'Pan the board, zoom in and out, or fit the view.';
export const BOARD_KEYBOARD_HINT = 'Arrow keys pan the board. Plus and minus zoom. 0 fits the board, 1 resets to 100%.';
export const BOARD_KEYBOARD_SHORTCUTS = 'ArrowLeft ArrowRight ArrowUp ArrowDown + - 0 1';
export const ZOOM_IN_LABEL = 'Zoom in';
export const ZOOM_OUT_LABEL = 'Zoom out';
export const RESET_ZOOM_LABEL = 'Reset zoom to 100%';
export const FIT_VIEW_LABEL = 'Fit board to content';
export const AUTO_FIT_LABEL = 'Auto-fit';
export const ZOOM_CONTROL_LABEL = 'Viewport controls';
export const BOARD_TOOLBAR_LABEL = 'Board controls';
export const CLEAR_BOARD_LABEL = 'Clear board';
export const CLEAR_BOARD_TOOLTIP = 'Clear all activities and timeline slots';
export const CLEAR_BOARD_CONFIRM_TITLE = 'Clear board?';
export const CLEAR_BOARD_CONFIRM_MESSAGE =
  'This will remove all activities from the board and reset your weekend plan. This action cannot be undone.';
export const CLEAR_BOARD_CONFIRM_ACTION = 'Clear board';
export const CLEAR_BOARD_CANCEL_ACTION = 'Keep board';
export const AUTO_FIT_TOGGLE_ON = 'On';
export const AUTO_FIT_TOGGLE_OFF = 'Off';
export const AUTO_FIT_ACTIVE_LABEL = 'Auto-fit is enabled';
export const AUTO_FIT_INACTIVE_LABEL = 'Auto-fit is disabled';
export const TIMELINE_LABEL = 'Weekend timeline';
export const TIMELINE_SLOT_EMPTY = 'Empty slot';
export const UNDOCK_CARD_LABEL = 'Remove from timeline';
export const TIMELINE_SLOTS = [
  { id: 'saturday-morning', label: 'Saturday morning' },
  { id: 'saturday-afternoon', label: 'Saturday afternoon' },
  { id: 'saturday-evening', label: 'Saturday evening' },
  { id: 'sunday-morning', label: 'Sunday morning' },
  { id: 'sunday-afternoon', label: 'Sunday afternoon' },
  { id: 'sunday-evening', label: 'Sunday evening' },
] as const;

export const TIMELINE_COLLAPSED_LABEL = 'Weekend Timeline';
export const TIMELINE_COLLAPSED_HINT = 'Click to expand · Drop cards here';
export const TIMELINE_EXPAND_LABEL = 'Expand weekend timeline';
export const TIMELINE_COLLAPSE_LABEL = 'Minimize timeline';
export const TIMELINE_DRAG_COLLAPSE_HINT = 'Press Esc or click _ to minimize';
export function timelinePlannedCount(docked: number, total: number): string {
  return `${docked}/${total} planned`;
}
export const TIMELINE_GUIDE_TOAST =
  'Weekend timeline: drag activities here to schedule your weekend, or click to expand.';
export const DISCARD_GUIDE_TOAST = 'Discard bin: drag unwanted cards here to remove them from your board.';
export const AUTOFIT_GUIDE_TOAST = 'Auto-fit: automatically frames new cards into view.';
export const AUTO_FIT_DESCRIPTION = 'Automatically frames new cards into view.';
export function timelineSlotMismatchMessage(expectedSlotLabel: string): string {
  return `This activity is scheduled for ${expectedSlotLabel}. Drop it in that slot!`;
}
export const TIMELINE_SLOT_REPLACE_ALERT =
  'Dropping this activity here will replace the scheduled one and return it to the board.';
export function timelineSlotReplaceAlert(existingTitle: string): string {
  return `Dropping here will replace "${existingTitle}" and return it to the board.`;
}
export function timelineActivityReplacedConfirmation(oldTitle: string): string {
  return `Replaced "${oldTitle}" and returned it to the board.`;
}

export function timelineActivityDockedConfirmation(slotLabel: string): string {
  return `Added to ${slotLabel}`;
}

export type FreeSlotChipDefinition = {
  id: string;
  label: string;
  start: string;
  end: string;
};

export const FREE_TIME_SLOTS: readonly FreeSlotChipDefinition[] = [
  {
    id: 'saturday-morning',
    label: 'Sat Morning',
    start: '2026-10-10T01:00:00Z',
    end: '2026-10-10T04:00:00Z',
  },
  {
    id: 'saturday-afternoon',
    label: 'Sat Afternoon',
    start: '2026-10-10T05:00:00Z',
    end: '2026-10-10T10:00:00Z',
  },
  {
    id: 'saturday-evening',
    label: 'Sat Evening',
    start: '2026-10-10T10:00:00Z',
    end: '2026-10-10T14:00:00Z',
  },
  {
    id: 'sunday-morning',
    label: 'Sun Morning',
    start: '2026-10-11T01:00:00Z',
    end: '2026-10-11T04:00:00Z',
  },
  {
    id: 'sunday-afternoon',
    label: 'Sun Afternoon',
    start: '2026-10-11T05:00:00Z',
    end: '2026-10-11T10:00:00Z',
  },
  {
    id: 'sunday-evening',
    label: 'Sun Evening',
    start: '2026-10-11T10:00:00Z',
    end: '2026-10-11T14:00:00Z',
  },
] as const;

export const SEARCH_INPUT_LABEL = 'Search query';
export const SEARCH_PANEL_LABEL = 'Find activities';
export const SEARCH_INPUT_PLACEHOLDER =
  'What are you looking to do? (e.g. cultural walk in Kowloon, hiking in Sai Kung...)';
export const SEARCH_SUBMIT_LABEL = 'Ask Agent';
export const SEARCH_SUBMIT_LOADING = 'Researching...';
export const FREE_SLOTS_LABEL = 'Select your free slots';
export const AGENT_STATUS_TITLE = 'Agent status';
export const AGENT_STATUS_IDLE = 'Agent ready';
export const AGENT_STATUS_SEARCHING = 'Agent is researching and ranking activities...';
export function agentStatusResults(count: number): string {
  return `Found ${count} activities`;
}
export const AGENT_STATUS_ERROR =
  'Could not reach the activity agent. Please check your connection or try the demo seed data.';
export const AGENT_CONNECTION_ERROR_502 =
  'Backend service is unavailable (HTTP 502 Bad Gateway). Please verify the API server is running on port 8000 or switch to Mock Data.';
export const AGENT_CONNECTION_ERROR_NETWORK =
  'Unable to connect to the backend server. Please verify the API server is running or switch to Mock Data.';
export const AGENT_ERROR_LOG_PREFIX = 'Request failed';

export function formatAgentErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message.includes('502')) {
      return AGENT_CONNECTION_ERROR_502;
    }
    if (
      error.message.includes('Failed to fetch') ||
      error.message.includes('NetworkError') ||
      error.message.includes('ECONNREFUSED')
    ) {
      return AGENT_CONNECTION_ERROR_NETWORK;
    }
    return error.message;
  }
  return AGENT_STATUS_ERROR;
}
export const AGENT_LOG_LABEL = 'Agent log';
export const AGENT_LOG_EMPTY = 'No agent steps recorded yet.';
export const AGENT_LOG_SHOW = 'Show agent log';
export const AGENT_LOG_HIDE = 'Hide agent log';
export const AGENT_USE_DEMO = 'Load mock data';
export const DATA_SOURCE_LABEL = 'Data source mode';
export const DATA_SOURCE_LIVE = 'Live API';
export const DATA_SOURCE_MOCK = 'Mock Data';

export const ACTIVITY_CARD_LABEL = 'Activity card';
export const ACTIVITY_CARD_ORIGINAL_TITLE_LABEL = 'Original title';
export const ACTIVITY_CARD_LANGUAGE_LABEL = 'Language';
export const ACTIVITY_CARD_LANGUAGE_ENGLISH = 'English';
export const ACTIVITY_CARD_LANGUAGE_CHINESE = 'Chinese';
export const ACTIVITY_CARD_LANGUAGE_BILINGUAL = 'Bilingual';
export const ACTIVITY_CARD_LANGUAGE_ENGLISH_AVAILABLE = 'English Available';

export function getActivityLanguageBadge(
  activity: {
    title?: string;
    lang?: string;
    tags?: readonly string[];
    source?: { name?: string };
  },
  rationale?: string,
): string {
  const title = activity.title ?? '';
  const hasChinese = /[\u4e00-\u9fa5]/.test(title);
  const tags = activity.tags ?? [];
  const sourceName = activity.source?.name ?? '';
  const rationaleText = rationale ?? '';

  const hasEnglishTag = tags.some(
    (t) => t === 'english-available' || t === 'english-guide' || t === 'en-available' || t === 'english-friendly',
  );
  const hasBilingualTag = tags.some((t) => t === 'bilingual' || t === 'bilateral' || t === 'language-exchange');

  const rationaleMentionsEnglish = /(?:english (?:guid|avail|tour|friend|support)|bilingual)/i.test(rationaleText);

  // International bilingual arts venues that provide dual English/Cantonese curation
  const isBilingualVenue = /M\+|Tai Kwun|Fringe Club|Crossroads|CHAT|Language Exchange/i.test(sourceName);

  // Pure English: no Chinese characters, or explicitly declared lang="en" with English text
  if (activity.lang === 'en' || (!hasChinese && /[a-zA-Z]/.test(title))) {
    return ACTIVITY_CARD_LANGUAGE_ENGLISH;
  }

  // Explicit bilingual tag or title has both significant Chinese and English words, or bilingual venue
  if (hasBilingualTag || (hasChinese && /[a-zA-Z]{4,}/.test(title)) || isBilingualVenue) {
    return ACTIVITY_CARD_LANGUAGE_BILINGUAL;
  }

  // Chinese event with English guidance/tour available
  if (hasEnglishTag || (hasChinese && rationaleMentionsEnglish)) {
    return ACTIVITY_CARD_LANGUAGE_ENGLISH_AVAILABLE;
  }

  // Authentic Chinese/Cantonese source
  return ACTIVITY_CARD_LANGUAGE_CHINESE;
}

export const ACTIVITY_CARD_TIME_UNAVAILABLE = 'Time to be confirmed';
export const ACTIVITY_CARD_SOURCE_LABEL = 'Source';
export const ACTIVITY_CARD_MATCH_RATIONALE_LABEL = 'Why it matches';
export const FIND_SIMILAR_LABEL = 'Find similar';
export const DISCARD_BIN_LABEL = 'Discard bin';
export const DISCARD_BIN_HINT = 'Drop a card here to remove it from the board.';
export const BOARD_EMPTY_STATE = 'Your board is clear. Find similar activities to explore more.';
export const INITIAL_ACTIVITY_QUERY = 'free saturday afternoon, something cultural in Kowloon, English friendly';

export function activityCardAccessibleLabel(title: string, language?: string): string {
  if (language) {
    return `${ACTIVITY_CARD_LABEL}: ${title} (${ACTIVITY_CARD_LANGUAGE_LABEL}: ${language})`;
  }
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

export function formatLogTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-GB', {
      timeZone: 'Asia/Hong_Kong',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return isoString;
  }
}

export const HEADING = 'Hongxplore';
export const TAGLINE = 'Infinite whiteboard + AI activity agent for students in Hong Kong.';

export const GATHERING_INFO_TITLE = 'Gathering info for you...';
export const GATHERING_INFO_SUBTITLE = 'Researching and ranking weekend activities...';
export const GATHERING_INFO_LABEL = 'AI research in progress: gathering activities';
