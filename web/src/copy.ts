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
export const AUTO_TILE_LABEL = 'Auto-tile board';
export const AUTO_TILE_TOOLTIP = 'Re-pack all cards without overlaps';
export const ZOOM_CONTROL_LABEL = 'Viewport controls';
export const BOARD_TOOLBAR_LABEL = 'Board controls';
export const CLEAR_BOARD_LABEL = 'Clear board';
export const CLEAR_BOARD_TOOLTIP = 'Clear all activities and timeline slots';
export const CLEAR_BOARD_CONFIRM_TITLE = 'Clear board?';
export const CLEAR_BOARD_CONFIRM_MESSAGE =
  'This will remove all activities from the board and reset your weekend plan. This action cannot be undone.';
export const CLEAR_BOARD_CONFIRM_ACTION = 'Clear board';
export const CLEAR_BOARD_CANCEL_ACTION = 'Keep board';
export const HELP_LABEL = 'Help';
export const HELP_TOOLTIP = 'Product guide';
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
/**
 * The three ways in, because hover now is one of them.
 *
 * Written as affordances rather than instructions, and the whole thing is decorative on top of
 * the button's `aria-label`: a hover is meaningless to a screen-reader user, so the copy they
 * actually hear is `TIMELINE_EXPAND_LABEL` and this text is only what the eye reads.
 */
export const TIMELINE_COLLAPSED_HINT = 'Hover to preview · Click to expand · Drop cards here';
export const TIMELINE_EXPAND_LABEL = 'Expand weekend timeline';
export const TIMELINE_COLLAPSE_LABEL = 'Minimize timeline';
export const TIMELINE_DRAG_COLLAPSE_HINT = 'Press Esc or click _ to minimize';
export function timelinePlannedCount(docked: number, total: number): string {
  return `${docked}/${total} planned`;
}
export const TIMELINE_GUIDE_TOAST =
  'Weekend timeline: hover to preview, click to keep it open, or drop activities here to schedule your weekend.';
export const DISCARD_GUIDE_TOAST = 'Discard bin: drag unwanted cards here to remove them from your board.';
export const AUTOFIT_GUIDE_TOAST = 'Auto-fit: automatically frames new cards into view.';
export const AUTO_FIT_DESCRIPTION = 'Automatically frames new cards into view.';

export const PRODUCT_TOUR_LABEL = 'Product guide';
export const TOUR_SEARCH_TITLE = 'Ask the agent';
export const TOUR_SEARCH_BODY =
  'Describe what you want to do this weekend, or select your free time slots to discover matching activities.';
export const TOUR_CARD_TITLE = 'Explore activities';
export const TOUR_CARD_BODY =
  'Review matched activities with timing, district, price, and direct links to official booking sites.';
export const TOUR_TIMELINE_TITLE = 'Plan your weekend';
export const TOUR_TIMELINE_BODY =
  'Drag activities into the timeline slots at the bottom to build and organize your weekend itinerary.';
export const TOUR_TOOLBAR_TITLE = 'Board controls';
export const TOUR_TOOLBAR_BODY =
  'Pan and zoom the canvas, fit or tile cards, toggle auto-fit, or click Help (?) anytime to reopen this guide.';

export const TOUR_NEXT_LABEL = 'Next';
export const TOUR_PREV_LABEL = 'Back';
export const TOUR_FINISH_LABEL = 'Got it';
export const TOUR_SKIP_LABEL = 'Skip guide';

export function tourStepCount(current: number, total: number): string {
  return `Step ${current} of ${total}`;
}

export function tourStepAnnouncement(current: number, total: number, title: string): string {
  return `Product guide, step ${current} of ${total}: ${title}`;
}
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

/**
 * Standard operating time windows in HKT (Asia/Hong_Kong, UTC+8):
 * - Morning: 09:00 - 12:00 HKT (01:00 - 04:00 UTC)
 * - Afternoon: 13:00 - 18:00 HKT (05:00 - 10:00 UTC)
 * - Evening: 18:00 - 22:00 HKT (10:00 - 14:00 UTC)
 */
const FREE_SLOT_WINDOWS = [
  { id: 'saturday-morning', label: 'Sat Morning', day: 'saturday', startUtc: '01:00:00Z', endUtc: '04:00:00Z' },
  { id: 'saturday-afternoon', label: 'Sat Afternoon', day: 'saturday', startUtc: '05:00:00Z', endUtc: '10:00:00Z' },
  { id: 'saturday-evening', label: 'Sat Evening', day: 'saturday', startUtc: '10:00:00Z', endUtc: '14:00:00Z' },
  { id: 'sunday-morning', label: 'Sun Morning', day: 'sunday', startUtc: '01:00:00Z', endUtc: '04:00:00Z' },
  { id: 'sunday-afternoon', label: 'Sun Afternoon', day: 'sunday', startUtc: '05:00:00Z', endUtc: '10:00:00Z' },
  { id: 'sunday-evening', label: 'Sun Evening', day: 'sunday', startUtc: '10:00:00Z', endUtc: '14:00:00Z' },
] as const;

function padTwoDigits(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * Derives upcoming weekend dates in HKT (`Asia/Hong_Kong`, UTC+8) dynamically (Issue #69).
 * Matches backend `compute_upcoming_weekend_dates`:
 * - Mon–Fri: upcoming Saturday and Sunday.
 * - Sat: Saturday is today, Sunday is tomorrow.
 * - Sun: Saturday is yesterday, Sunday is today.
 * - Mon rolls over to the next weekend.
 */
export function computeUpcomingWeekendDates(referenceTime: Date = new Date()): {
  saturday: string;
  sunday: string;
} {
  const HKT_OFFSET_MS = 8 * 60 * 60 * 1000;
  const hkt = new Date(referenceTime.getTime() + HKT_OFFSET_MS);

  const year = hkt.getUTCFullYear();
  const month = hkt.getUTCMonth();
  const date = hkt.getUTCDate();
  const day = hkt.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat

  const daysToSat = day === 0 ? -1 : 6 - day;
  const sat = new Date(Date.UTC(year, month, date + daysToSat));
  const sun = new Date(Date.UTC(year, month, date + daysToSat + 1));

  const satStr = `${sat.getUTCFullYear()}-${padTwoDigits(sat.getUTCMonth() + 1)}-${padTwoDigits(sat.getUTCDate())}`;
  const sunStr = `${sun.getUTCFullYear()}-${padTwoDigits(sun.getUTCMonth() + 1)}-${padTwoDigits(sun.getUTCDate())}`;

  return { saturday: satStr, sunday: sunStr };
}

/**
 * Computes live free-slot chips for the upcoming weekend in HKT (Issue #69).
 *
 * 1. Computes upcoming Saturday and Sunday dates dynamically in HKT; no hardcoded dates remain.
 * 2. Enforces that no chip ever names a period that has already started (`start > referenceTime`).
 * 3. If all periods of the current weekend have already started (e.g. late Sunday evening),
 *    rolls forward to the following weekend so the user always has upcoming slots to plan.
 */
export function getUpcomingWeekendFreeSlots(referenceTime: Date = new Date()): FreeSlotChipDefinition[] {
  const dates = computeUpcomingWeekendDates(referenceTime);

  const candidateSlots: FreeSlotChipDefinition[] = FREE_SLOT_WINDOWS.map((window) => ({
    id: window.id,
    label: window.label,
    start: `${dates[window.day]}T${window.startUtc}`,
    end: `${dates[window.day]}T${window.endUtc}`,
  }));

  const nowMs = referenceTime.getTime();
  let available = candidateSlots.filter((slot) => new Date(slot.start).getTime() > nowMs);

  if (available.length === 0) {
    // Current weekend has passed or all slots have started; roll forward by 7 days to next weekend
    const nextWeekendRef = new Date(referenceTime.getTime() + 7 * 24 * 60 * 60 * 1000);
    const nextDates = computeUpcomingWeekendDates(nextWeekendRef);
    available = FREE_SLOT_WINDOWS.map((window) => ({
      id: window.id,
      label: window.label,
      start: `${nextDates[window.day]}T${window.startUtc}`,
      end: `${nextDates[window.day]}T${window.endUtc}`,
    }));
  }

  return available;
}

/**
 * Live upcoming weekend free-slot chips for the current instant.
 * Dynamically computed so no hardcoded calendar date survives in copy.
 */
export const FREE_TIME_SLOTS: readonly FreeSlotChipDefinition[] = getUpcomingWeekendFreeSlots();

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
/** Explicit close for the floating popover. Escape and an outside click already close it, but a
    touch user has no Escape key, and a dismissable surface with no visible way out reads as
    stuck. */
export const AGENT_LOG_CLOSE = 'Close agent log';
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
export const ACTIVITY_CARD_MATCH_RATIONALE_LABEL = 'Why it matches';
export const ACTIVITY_CARD_DISTRICT_LABEL = 'District';

/**
 * Labels for the card's ruled data rows.
 *
 * These read as row headings in a ruled table, which is why they are written the way a
 * board operator would read them out — `Venue`, `Price`, `Listed` — rather than as field
 * names from the API (`location.venue`, `price.is_free`, `listed_at`).
 */
export const ACTIVITY_CARD_ROW_VENUE_LABEL = 'Venue';
export const ACTIVITY_CARD_ROW_PRICE_LABEL = 'Price';
export const ACTIVITY_CARD_ROW_LISTED_LABEL = 'Listed';
export const ACTIVITY_CARD_PRICE_FREE = 'Free';
export const ACTIVITY_CARD_PRICE_UNKNOWN = 'Not listed';
export const ACTIVITY_CARD_LISTED_UNKNOWN = 'No date';

/**
 * Price cell.
 *
 * The schema distinguishes "free of charge" (`is_free`, no amount) from "priced" (an amount
 * plus a currency), and also allows a null price — so all three get their own cell text rather
 * than collapsing into one blank. An unknown price is written out rather than left empty,
 * because an empty cell in a ruled table reads as a bug.
 */
export function activityCardPriceLabel(
  price:
    | {
        amount?: string | null;
        currency: string;
        is_free: boolean;
      }
    | null
    | undefined,
): string {
  if (!price) {
    return ACTIVITY_CARD_PRICE_UNKNOWN;
  }

  if (price.is_free) {
    return ACTIVITY_CARD_PRICE_FREE;
  }

  return price.amount ? `${price.amount} ${price.currency}` : ACTIVITY_CARD_PRICE_UNKNOWN;
}

const listedOnFormatter = new Intl.DateTimeFormat('en-HK', {
  day: '2-digit',
  month: 'short',
  timeZone: 'Asia/Hong_Kong',
});

/**
 * Freshness cell.
 *
 * Absolute, not relative. A split-flap board states when a row was posted; it does not count
 * down. It also means the cell cannot go stale or silently change width as the clock runs.
 * Stored UTC, displayed HKT — the repo rule.
 */
export function activityCardListedLabel(listedAt: string | null | undefined): string {
  if (!listedAt) {
    return ACTIVITY_CARD_LISTED_UNKNOWN;
  }

  const date = new Date(listedAt);

  if (Number.isNaN(date.getTime())) {
    return ACTIVITY_CARD_LISTED_UNKNOWN;
  }

  return listedOnFormatter.format(date);
}

/** The serial plate in the card header. Zero-padded to two digits, like a board row. */
export function activityCardSerial(index: number): string {
  return String(index + 1).padStart(2, '0');
}

/** Index of the research placeholder, so the pending card carries the same plate as the results. */
export const ACTIVITY_CARD_PENDING_SERIAL = '00';

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

/**
 * The card's source CTA. Ported from #112 (kORNkin), which was written against the pre-Blue-Hour
 * card: everything else that PR asked for — district, price, freshness, the original CJK title —
 * is already delivered by the ruled data rows added in #111, so only the CTA was genuinely new.
 *
 * It links `activity.url` (the booking page, required on the contract) rather than
 * `activity.source.url` (the organisation's own page, optional), so the CTA is always present.
 */
export function activityCardCtaLabel(sourceName: string): string {
  return `Visit ${sourceName}`;
}

export function findSimilarConfirmation(title: string): string {
  return `Looking for activities similar to ${title}.`;
}

export function findSimilarExhaustedConfirmation(title: string): string {
  return `No new activities found similar to ${title}.`;
}

export function zoomPercentage(value: number): string {
  return `Zoom: ${Math.round(value * 100)}%`;
}

/**
 * The toolbar readout cell: the bare number, because the rail is 40px wide and the control
 * that carries it is an icon rail rather than a column of text.
 *
 * The accessible name stays the long form — the visible string is `aria-hidden` and the live
 * region announces `zoomPercentage()` instead, so what a screen reader hears is "Zoom: 80%"
 * and not a number with nothing to attach it to.
 */
export function zoomReadout(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** The reset control doubles as the readout, so its name states what clicking it does now. */
export function resetZoomLabel(value: number): string {
  return `${RESET_ZOOM_LABEL} — ${zoomPercentage(value)}`;
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
/** Tracked caps on the pending card's header row. Amber means pending, and this is pending. */
export const GATHERING_INFO_PLATE_LABEL = 'Gathering';
