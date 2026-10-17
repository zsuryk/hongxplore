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
export const TOUR_MODE_TITLE = 'Drag and inspect modes';
export const TOUR_MODE_BODY =
  'Switch between Drag and grab, Just drag, or Drag and inspect. Use this top-left dropdown on any device, or right-click anywhere on the board on desktop for the radial wheel (mobile uses the dropdown only).';
export const TOUR_TOOLBAR_TITLE = 'Board controls';
export const TOUR_TOOLBAR_BODY =
  'Zoom, fit all cards into view, auto-tile overlapping cards, or reopen this guide anytime with the Help (?) button.';

export const BOARD_MODE_WHEEL_LABEL = 'Board interaction mode wheel';
export const BOARD_MODE_WHEEL_CLOSE_LABEL = 'Close mode wheel';
export const BOARD_MODE_DROPDOWN_LABEL = 'Board interaction mode menu';
export const BOARD_MODE_TRIGGER_LABEL = 'Switch board interaction mode';
export const BOARD_MODE_GRAB_LABEL = 'Drag and grab';
export const BOARD_MODE_GRAB_HINT = 'Pan canvas · Move cards';
export const BOARD_MODE_PAN_LABEL = 'Just drag';
export const BOARD_MODE_PAN_HINT = 'Pan canvas freely over cards';
export const BOARD_MODE_INSPECT_LABEL = 'Drag and inspect';
export const BOARD_MODE_INSPECT_HINT = 'Pan · Hover cards to read titles';
export const BOARD_INSPECT_CALLOUT_LABEL = 'Inspected activity title';

export function boardModeActiveLabel(modeLabel: string): string {
  return `Mode: ${modeLabel}`;
}

export function boardModeSelectedConfirmation(modeLabel: string): string {
  return `Switched to ${modeLabel} mode`;
}

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
  'Backend service is unavailable (HTTP 502 Bad Gateway). Please verify the API server is running on port 8000 or switch to Demo data.';
export const AGENT_CONNECTION_ERROR_NETWORK =
  'Unable to connect to the backend server. Please verify the API server is running or switch to Demo data.';
export const AGENT_ERROR_LOG_PREFIX = 'Request failed';

/** Why the server refused a live request. Mirrors `AccessDeniedReason` in the API contract. */
export type AgentAccessDeniedReason = 'missing_key' | 'invalid_key' | 'demo_only_instance';

/**
 * Copy per refusal reason.
 *
 * "Paste the key" is useless advice for a key that *was* pasted but not
 * recognised, and useless again for an instance that cannot reach live providers
 * however good the key is — so each reason gets its own sentence.
 */
export const AGENT_ACCESS_DENIED_COPY: Record<AgentAccessDeniedReason, string> = {
  missing_key: 'Live mode needs the agent access key from the pitch deck. Paste it below and ask again.',
  invalid_key: 'That agent access key is not recognised. Check the key printed in the pitch deck and try again.',
  demo_only_instance:
    'This instance runs in demo mode, so it cannot reach the live providers. The full demo still works.',
};

/** True for the errors the live-mode gate throws, without importing the client into copy. */
export function isAgentAccessDenied(error: unknown): error is Error & {
  reason: AgentAccessDeniedReason;
} {
  return (
    error instanceof Error &&
    'reason' in error &&
    typeof (error as { reason?: unknown }).reason === 'string' &&
    (error as { reason: string }).reason in AGENT_ACCESS_DENIED_COPY
  );
}

/** Why the server refused the request itself. Mirrors `RequestRejectedReason` in the API contract. */
export type AgentRequestRejectedReason =
  'rate_limited' | 'request_too_large' | 'query_too_long' | 'too_many_free_slots';

/**
 * Copy per rejection reason.
 *
 * The way out differs per reason and that is the whole point of keeping them
 * apart: a rate limit clears on its own, an oversized request needs a shorter
 * one. A single "request failed" sentence would send someone to the wrong fix.
 *
 * No numbers, and no status codes — a status code reads as a bug report to
 * someone who simply asked too fast.
 */
export const AGENT_REQUEST_REJECTED_COPY: Record<AgentRequestRejectedReason, string> = {
  rate_limited: 'Easy there — that is a lot of questions at once. Give it a few seconds and ask again.',
  request_too_large: 'That request is bigger than this demo can take. Try a shorter question with fewer time slots.',
  query_too_long: 'That question is too long for this demo. Try something shorter and more specific.',
  too_many_free_slots: 'That is more free time than this demo can plan. Try selecting fewer slots.',
};

/** True for a request refused on its own terms — never for a refused live mode. */
export function isAgentRequestRejected(error: unknown): error is Error & {
  reason: AgentRequestRejectedReason;
  retryAfterSeconds?: number;
} {
  return (
    error instanceof Error &&
    'reason' in error &&
    typeof (error as { reason?: unknown }).reason === 'string' &&
    (error as { reason: string }).reason in AGENT_REQUEST_REJECTED_COPY
  );
}

/**
 * How an agent request failed.
 *
 * The store has to tell "the server refused us" apart from "there was no server
 * at all", because only the second may fall back to the bundled fixture.
 * Downgrading a *refusal* to seed data is how a judge ends up looking at demo
 * results believing they are live ones — the exact failure the gate prevents.
 */
export type AgentErrorKind = 'access_denied' | 'request_rejected' | 'bad_gateway' | 'server_unreachable' | 'unknown';

export function classifyAgentError(error: unknown): AgentErrorKind {
  if (isAgentAccessDenied(error)) return 'access_denied';
  if (isAgentRequestRejected(error)) return 'request_rejected';
  if (!(error instanceof Error)) return 'unknown';
  if (error.message.includes('502')) return 'bad_gateway';
  if (
    error.message.includes('Failed to fetch') ||
    error.message.includes('NetworkError') ||
    error.message.includes('ECONNREFUSED')
  ) {
    return 'server_unreachable';
  }
  return 'unknown';
}

/** Whether the fixture fallback is allowed to stand in for this failure. */
export function isServerUnreachable(error: unknown): boolean {
  return classifyAgentError(error) === 'server_unreachable';
}

export function formatAgentErrorMessage(error: unknown): string {
  if (isAgentAccessDenied(error)) {
    return AGENT_ACCESS_DENIED_COPY[error.reason];
  }
  // The client's own copy wins over the server's message, for the same reason as
  // above: these sentences are the ones written for someone reading a screen.
  if (isAgentRequestRejected(error)) {
    return AGENT_REQUEST_REJECTED_COPY[error.reason];
  }
  switch (classifyAgentError(error)) {
    case 'bad_gateway':
      return AGENT_CONNECTION_ERROR_502;
    case 'server_unreachable':
      return AGENT_CONNECTION_ERROR_NETWORK;
    default:
      return error instanceof Error ? error.message : AGENT_STATUS_ERROR;
  }
}
export const AGENT_LOG_LABEL = 'Agent log';
export const AGENT_LOG_EMPTY = 'No agent steps recorded yet.';
export const AGENT_LOG_SHOW = 'Show agent log';
export const AGENT_LOG_HIDE = 'Hide agent log';
/** Explicit close for the floating popover. Escape and an outside click already close it, but a
    touch user has no Escape key, and a dismissable surface with no visible way out reads as
    stuck. */
export const AGENT_LOG_CLOSE = 'Close agent log';
/** Demo mode now asks the *server* for the seed dataset (issue #83); the bundled
    fixture is only the fallback for when no API is reachable at all. */
export const AGENT_USE_DEMO = 'Load demo data';
export const DATA_SOURCE_LABEL = 'Data source mode';
export const DATA_SOURCE_LIVE = 'Live API';
export const DATA_SOURCE_DEMO = 'Demo data';

export const ACCESS_KEY_MODAL_TITLE = 'Live Mode Agent Access Key';
export const ACCESS_KEY_MODAL_DESCRIPTION =
  'Enter the agent access key from the pitch deck to unlock live search and real-time LLM recommendations. This key is an access gate for our server, not a provider API key — provider credentials never leave our server.';
export const ACCESS_KEY_INPUT_LABEL = 'Agent access key';
export const ACCESS_KEY_INPUT_PLACEHOLDER = 'Paste the access key from the pitch deck';
export const ACCESS_KEY_SUBMIT_LABEL = 'Unlock Live Mode';
export const ACCESS_KEY_CANCEL_LABEL = 'Stay in Demo Mode';
export const ACCESS_KEY_CLEAR_LABEL = 'Clear key';
export const ACCESS_KEY_REPLACE_LABEL = 'Change key';
export const ACCESS_KEY_HELP_TEXT =
  'The access key is held in browser storage for this session only and is never logged or exposed. Demo mode requires no key.';
export const ACCESS_KEY_MASKED = '••••••••';
export const accessKeyMaskedLabel = (masked: string) => `Agent access key: ${masked}`;

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

/* ---- Deck View strings (issue #140) ---- */
export const VIEW_SWITCHER_LABEL = 'Switch view mode';
export const VIEW_MODE_BOARD_LABEL = 'Board';
export const VIEW_MODE_BOARD_TOOLTIP = 'Infinite whiteboard view';
export const VIEW_MODE_DECK_LABEL = 'Deck';
export const VIEW_MODE_DECK_TOOLTIP = 'Card-by-card deck navigation';

export const DECK_DISCARD_LABEL = 'Discard activity';
export const DECK_DISCARD_TOOLTIP = 'Discard (← or Backspace)';
export const DECK_UNDO_LABEL = 'Undo last action';
export const DECK_UNDO_TOOLTIP = 'Undo (Z or Cmd+Z)';
export const DECK_SKIP_LABEL = 'Skip to back';
export const DECK_SKIP_TOOLTIP = 'Skip to back of stack (Space)';
export const DECK_DOCK_LABEL = 'Quick dock';
export const DECK_DOCK_TOOLTIP = 'Schedule to weekend (→ or Enter)';
export const DECK_SLOT_PICKER_TITLE = 'Choose a weekend slot';
export const DECK_SLOT_PICKER_HINT = 'Select which time slot to schedule this activity';
export const DECK_KEYBOARD_HINT = 'Left arrow discards, right arrow docks, space skips, Z undoes.';
export const DECK_SWIPE_DISCARD_HINT = 'Swipe left to discard';
export const DECK_SWIPE_DOCK_HINT = 'Swipe right to schedule';

export function deckStackCount(current: number, total: number): string {
  return `${current} of ${total}`;
}

export function deckCardsRemaining(count: number): string {
  return `${count} remaining`;
}

export const DECK_EMPTY_TITLE = 'All activities reviewed';
export const DECK_EMPTY_BODY = 'You have gone through all returned activities for this query.';
export const DECK_EMPTY_VIEW_PLAN_CTA = 'View weekend plan';
export const DECK_EMPTY_RESTORE_CTA = 'Restore discarded activities';
export const DECK_EMPTY_SEARCH_CTA = 'Search for more';

export const DECK_BOOKING_GUIDE_BADGE = 'Facility booking guide';
export const DECK_MATCH_RATIONALE_LABEL = 'Why this matches';
export const DECK_LOCATION_LABEL = 'Location';
export const DECK_SCHEDULE_LABEL = 'Schedule';
export const DECK_PRICE_LABEL = 'Price';
export const DECK_EXTERNAL_LINK_LABEL = 'Open details & booking';
export const TAGS_LABEL = 'Tags';

export function deckExternalLinkLabel(sourceName: string): string {
  return `${DECK_EXTERNAL_LINK_LABEL} (${sourceName})`;
}

export function deckSlotPickerChipLabel(slotLabel: string, isOccupied: boolean): string {
  return isOccupied ? `${slotLabel} (*)` : slotLabel;
}

export const DECK_DISCARD_PANEL_TITLE = 'Discard bin';
export const DECK_DISCARD_DROP_HINT = 'Drop card here to discard';
export const DECK_DISCARD_EMPTY_HINT = 'No discarded activities yet';
export const DECK_TIMELINE_PANEL_TITLE = 'Weekend schedule';
export const DECK_TIMELINE_DROP_HINT = 'Drag card here to schedule';
export const DECK_SLOT_AVAILABLE_LABEL = 'Available slot';
export const DECK_ACTION_DISCARD = 'Discard';
export const DECK_ACTION_UNDO = 'Undo';
export const DECK_ACTION_SKIP = 'Skip';
export const DECK_ACTION_DOCK = 'Schedule';
export const DECK_KEY_LEFT = '←';
export const DECK_KEY_RIGHT = '→';
export const DECK_KEY_SPACE = 'Space';
export const DECK_KEY_Z = 'Z';
export const DECK_RESTORE_ALL_LABEL = 'Restore all';
export const DECK_DROP_HINT_BAR = 'Drag card to any timeslot or discard bin · Or swipe left / right';
export const DECK_STAMP_DISCARD = 'Discard';
export const DECK_STAMP_SCHEDULE = 'Schedule';
export const DECK_STAMP_SKIP = 'Skip';
export const DECK_DISCARD_RESTORE_LABEL = 'Restore';
export const DECK_DISCARD_RESTORE_TOOLTIP = 'Restore this activity to deck';
export const DECK_DISCARD_QUEUE_TITLE = 'Discarded queue';
export const DECK_SLOT_DROP_HERE_HINT = 'Drop card to schedule';

export function deckDiscardedCount(count: number): string {
  return `${count} discarded`;
}

export function deckScheduledCount(count: number, total: number): string {
  return `${count} of ${total} slots scheduled`;
}
