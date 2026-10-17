import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ActivityCard } from './ActivityCard';
import { AgentAccessKeyModal } from './AgentAccessKeyModal';
import { AgentStatusPanel } from './AgentStatusPanel';
import { BoardToolbar } from './BoardToolbar';
import { DeckView } from './DeckView';
import { IconBoardView, IconClose, IconDeckView, IconModeGrab, IconModeInspect, IconModePan } from './icons';
import { ProductTour } from './ProductTour';
import { ResearchCard } from './ResearchCard';
import { SearchBar } from './SearchBar';
import {
  BOARD_EMPTY_STATE,
  BOARD_GUIDE_BODY,
  BOARD_GUIDE_TITLE,
  BOARD_INSPECT_CALLOUT_LABEL,
  BOARD_KEYBOARD_HINT,
  BOARD_KEYBOARD_SHORTCUTS,
  BOARD_LABEL,
  BOARD_MODE_DROPDOWN_LABEL,
  BOARD_MODE_GRAB_HINT,
  BOARD_MODE_GRAB_LABEL,
  BOARD_MODE_INSPECT_HINT,
  BOARD_MODE_INSPECT_LABEL,
  BOARD_MODE_PAN_HINT,
  BOARD_MODE_PAN_LABEL,
  BOARD_MODE_TRIGGER_LABEL,
  BOARD_MODE_WHEEL_CLOSE_LABEL,
  BOARD_MODE_WHEEL_LABEL,
  CLEAR_BOARD_CANCEL_ACTION,
  CLEAR_BOARD_CONFIRM_ACTION,
  CLEAR_BOARD_CONFIRM_MESSAGE,
  CLEAR_BOARD_CONFIRM_TITLE,
  DISCARD_BIN_HINT,
  DISCARD_BIN_LABEL,
  HEADING,
  INITIAL_ACTIVITY_QUERY,
  TAGLINE,
  TIMELINE_COLLAPSE_LABEL,
  TIMELINE_COLLAPSED_HINT,
  TIMELINE_COLLAPSED_LABEL,
  TIMELINE_DRAG_COLLAPSE_HINT,
  TIMELINE_EXPAND_LABEL,
  TIMELINE_LABEL,
  TIMELINE_SLOT_EMPTY,
  TIMELINE_SLOTS,
  UNDOCK_CARD_LABEL,
  VIEW_MODE_BOARD_LABEL,
  VIEW_MODE_BOARD_TOOLTIP,
  VIEW_MODE_DECK_LABEL,
  VIEW_MODE_DECK_TOOLTIP,
  VIEW_SWITCHER_LABEL,
  activityCardSerial,
  boardModeActiveLabel,
  boardModeSelectedConfirmation,
  findSimilarConfirmation,
  findSimilarExhaustedConfirmation,
  timelineActivityReplacedConfirmation,
  timelineActivityDockedConfirmation,
  timelinePlannedCount,
  timelineSlotMismatchMessage,
  timelineSlotReplaceAlert,
} from './copy';
import {
  BOARD_FIT_PADDING,
  BOARD_GRID_ORIGIN,
  BOARD_GRID_SIZE,
  CARD_DISCARD_DURATION_MS,
  CARD_MIN_HEIGHT,
  CARD_WIDTH,
  DEAL_DURATION_MS,
  DEAL_TILT_DEG,
  type DealStep,
  type PlacedBoardCard,
  type PlacedCard,
  areAnyCardsOutOfFrame,
  autoTileBoard,
  computeBoardLayout,
  contentBounds,
  dealDeckOrigin,
  dealTiming,
  findBestSquareSlot,
  getActivityMatchingSlotId,
  getCardVariant,
  placedCardAt,
  tiledCardPosition,
} from './boardLayout';
import {
  type ActivityCard as BoardActivityCard,
  type AgentStatus,
  type TimelineSlot,
  type ViewMode,
  useBoardStore,
} from './state/boardStore';
import {
  KEYBOARD_PAN_STEP,
  KEYBOARD_PAN_STEP_FAST,
  type Point,
  type Rect,
  type Viewport,
  canZoomIn,
  canZoomOut,
  fitViewport,
  initialViewport,
  nextZoomLevel,
  panViewport,
  pinchViewport,
  preserveViewportCenter,
  screenToWorld,
  smartCenter100,
  zoomAtScreenPoint,
} from './viewport';

/** Zoom ratio applied per notch of a scroll wheel or trackpad. */
const WHEEL_ZOOM_STEP = 1.15;
/** How long after the last wheel event the viewport stops counting as "gesturing". */
const GESTURE_SETTLE_MS = 160;
/** How long the "looking for similar activities" confirmation stays on the board. */
const CONFIRMATION_MS = 4000;
/** Storage key tracking whether the first-run product tour has already been seen. */
export const TOUR_STORAGE_KEY = 'hongxplore:product-tour-seen';
/**
 * How long the board waits for its re-framing to land before releasing the deal.
 *
 * Auto-tile moves cards *and* re-frames, and both start together. Running the deal while the
 * camera is still gliding means the first fifth of it plays against a moving board, and on a
 * cold load the pile is off-screen for most of it. One `--motion-base` of settle turns that
 * into two readable beats: *here is your board*, then *here is your weekend*. The deal itself
 * is unaffected — it is still `DEAL_DURATION_MS` from release to last card seated.
 */
const BOARD_FRAME_SETTLE_MS = 150;
/**
 * Longest the on-load deal waits for the card measurement pass.
 *
 * `autoTileBoard` packs by height, and at first paint `computeBoardLayout` has no measured
 * heights, so it packs by `calculateContentCardHeight`'s estimate — which on the shipped seed
 * data under-reports the tallest card by 31 world units and so packs a 9-unit gap where a
 * 40-unit one was asked for. Waiting one ResizeObserver round costs a frame and buys the real
 * numbers. This cap exists so a browser that never fires the observer still deals rather than
 * leaving the user with a board that never moves.
 */
const CARD_MEASURE_FALLBACK_MS = 250;
/**
 * How long the pointer must rest on the collapsed timeline before it opens.
 *
 * The collapsed panel sits in the bottom-left corner of the board, which is exactly where a
 * user reaches for a card. Reacting to entry alone makes an accidental expansion likely, so
 * expansion takes a deliberate dwell. A key press, a click or a card drop are all unambiguous
 * and none of them wait for this.
 */
const TIMELINE_HOVER_EXPAND_MS = 220;
/**
 * How long the timeline stays open after the pointer leaves it.
 *
 * Without a grace period, crossing the boundary while moving toward a slot collapses the panel
 * under the pointer and immediately re-expands it: a flicker, and on a trackpad a stutter.
 * Leaving has to be slower than entering so that a momentary exit is not treated as a decision.
 */
const TIMELINE_HOVER_COLLAPSE_MS = 420;

/**
 * Whether the user has asked for less motion.
 *
 * Read once per decision rather than cached: it can change while the tab is open, and a stale
 * answer here would either animate at somebody who opted out or strand somebody who did not.
 * Every consumer also has the `prefers-reduced-motion` block in `tokens.css` behind it — this
 * is the fast path that skips the animation entirely rather than collapsing it to 1ms.
 */
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

/** One card's place in a running deal: its timing plus where it starts from. */
type DealPlacement = DealStep & {
  fromX: number;
  fromY: number;
  tiltDeg: number;
  /** Reverse paint order, so the pile unpeels from the top rather than from the bottom. */
  stack: number;
};

/**
 * A deal in flight. `runId` is what makes an interrupted or superseded deal safe: a late timer
 * from a previous run cannot clear the state belonging to this one.
 */
type ActiveDeal = {
  runId: number;
  placements: Record<string, DealPlacement>;
  count: number;
};

type Size = {
  width: number;
  height: number;
};

type DragState = {
  pointerId: number;
  screenPoint: Point;
};

type PinchState = {
  distance: number;
  screenPoint: Point;
  viewport: Viewport;
};

export type CardDragState = {
  card: BoardActivityCard;
  cardSize?: Size;
  source: 'board' | 'timeline';
  fromSlotId?: string;
  pointerId: number;
  screenPoint: Point;
  grabOffset: Point;
  trail: Point[];
};

type DragParticle = {
  id: number;
  x: number;
  y: number;
  size: number;
  color: string;
  dx: number;
  dy: number;
};

/**
 * Drag particles dropped behind a card while it is being dragged.
 *
 * The palette is read from CSS custom properties rather than hardcoded here. These were six
 * literal cosmic hexes living in `App.tsx` — a raw colour in JS is the same defect as a raw
 * colour in a stylesheet, and the token contract test cannot see it, so the values now live in
 * `tokens.css` alongside the rest of the palette.
 *
 * Read lazily and memoised, not at module scope: a module-scope `getComputedStyle` read depends
 * on the stylesheet having been applied before this module executes, which is true in dev and
 * true in the production build (the CSS link is render-blocking), but is a load-order assumption
 * that nothing enforces and that a future import-site change could quietly break.
 */
let particlePalette: string[] | null = null;

function particleColors(): string[] {
  if (particlePalette) return particlePalette;
  if (typeof window === 'undefined') return [];
  const styles = getComputedStyle(document.documentElement);
  particlePalette = ['--particle-1', '--particle-2', '--particle-3', '--particle-4', '--particle-5', '--particle-6']
    .map((name) => styles.getPropertyValue(name).trim())
    .filter(Boolean);
  return particlePalette;
}

const EMPTY_CARD_POSITIONS: Record<string, Point> = {};

export type BoardInteractionMode = 'grab' | 'pan' | 'inspect';

const MODE_OPTIONS: ReadonlyArray<{
  id: BoardInteractionMode;
  label: string;
  hint: string;
  Icon: (props: { className?: string }) => ReactElement;
  posClass: string;
  sectorPath: string;
}> = [
  {
    id: 'grab',
    label: BOARD_MODE_GRAB_LABEL,
    hint: BOARD_MODE_GRAB_HINT,
    Icon: IconModeGrab,
    posClass: 'board-wheel__option--top',
    sectorPath: 'M 17.81 61 A 118 118 0 0 1 222.19 61 L 144.25 106 A 28 28 0 0 0 95.75 106 Z',
  },
  {
    id: 'pan',
    label: BOARD_MODE_PAN_LABEL,
    hint: BOARD_MODE_PAN_HINT,
    Icon: IconModePan,
    posClass: 'board-wheel__option--left',
    sectorPath: 'M 120 238 A 118 118 0 0 1 17.81 61 L 95.75 106 A 28 28 0 0 0 120 148 Z',
  },
  {
    id: 'inspect',
    label: BOARD_MODE_INSPECT_LABEL,
    hint: BOARD_MODE_INSPECT_HINT,
    Icon: IconModeInspect,
    posClass: 'board-wheel__option--right',
    sectorPath: 'M 222.19 61 A 118 118 0 0 1 120 238 L 120 148 A 28 28 0 0 0 144.25 106 Z',
  },
];

const INSPECT_MAX_ZOOM_PERCENT = 50;

export type AppProps = {
  agentStatus?: AgentStatus;
  cards?: BoardActivityCard[];
  initialCardDragState?: CardDragState | null;
  initialCardZIndexById?: Record<string, number>;
  initialClearConfirmOpen?: boolean;
  initialConfirmation?: string;
  initialHoverExpanded?: boolean;
  initialInspectedCardId?: string;
  initialInteractionMode?: BoardInteractionMode;
  initialIsOverDropZone?: boolean;
  initialModeDropdownOpen?: boolean;
  initialTimelineExpanded?: boolean;
  initialTourOpen?: boolean;
  initialViewportScale?: number;
  initialWheelPosition?: Point;
  initialViewMode?: ViewMode;
  timelineSlots?: TimelineSlot[];
};

export function App({
  agentStatus: propAgentStatus,
  cards: propCards,
  initialCardDragState,
  initialCardZIndexById,
  initialClearConfirmOpen,
  initialConfirmation,
  initialHoverExpanded,
  initialInspectedCardId,
  initialInteractionMode,
  initialIsOverDropZone,
  initialModeDropdownOpen,
  initialTimelineExpanded,
  initialTourOpen,
  initialViewportScale,
  initialWheelPosition,
  initialViewMode,
  timelineSlots: propTimelineSlots,
}: AppProps = {}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const discardBinRef = useRef<HTMLElement>(null);
  const userCollapsedDuringDragRef = useRef(false);
  const activePointersRef = useRef(new Map<number, Point>());
  const contentBoundsRef = useRef<Rect>(contentBounds([]));
  const hasAdjustedRef = useRef(false);
  const initialFramedRef = useRef(false);
  const cardDragStateRef = useRef<CardDragState | null>(null);
  const previousSizeRef = useRef<Size>({ width: 0, height: 0 });
  const gestureTimerRef = useRef<number | null>(null);
  const previousCardsLengthRef = useRef(0);
  const cardJustLandedRef = useRef(false);
  const particleIdRef = useRef(0);
  const particleCleanupTimerRef = useRef<number | null>(null);
  const dealRunIdRef = useRef(0);
  const dealStartTimerRef = useRef<number | null>(null);
  const dealEndTimerRef = useRef<number | null>(null);
  const hoverExpandTimerRef = useRef<number | null>(null);
  const hoverCollapseTimerRef = useRef<number | null>(null);

  const storeCards = useBoardStore((state) => state.cards);
  const cards = propCards ?? storeCards;
  const discardedCards = useBoardStore((state) => state.discardedCards);
  const storeTimelineSlots = useBoardStore((state) => state.timelineSlots);
  const timelineSlots =
    propTimelineSlots ??
    (storeTimelineSlots.length > 0
      ? storeTimelineSlots
      : TIMELINE_SLOTS.map((slot) => ({ id: slot.id, activityId: null })));
  const storeAgentStatus = useBoardStore((state) => state.agentStatus);
  const agentStatus = propAgentStatus ?? storeAgentStatus;
  const discardCard = useBoardStore((state) => state.discardCard);
  const dockCard = useBoardStore((state) => state.dockCard);
  const undockCard = useBoardStore((state) => state.undockCard);
  const findSimilar = useBoardStore((state) => state.findSimilar);
  const loadAgentResponse = useBoardStore((state) => state.loadAgentResponse);
  const setTimelineSlots = useBoardStore((state) => state.setTimelineSlots);
  const recentCardIds = useBoardStore((state) => state.recentCardIds);
  const requestClearBoard = useBoardStore((state) => state.requestClearBoard);
  const cancelClearBoard = useBoardStore((state) => state.cancelClearBoard);
  const confirmClearBoard = useBoardStore((state) => state.confirmClearBoard);
  const storeCardPositions = useBoardStore((state) => state.cardPositions);
  const cardPositionsById = storeCardPositions ?? EMPTY_CARD_POSITIONS;
  const setCardPosition = useBoardStore((state) => state.setCardPosition);
  const setCardPositions = useBoardStore((state) => state.setCardPositions);
  const storeCardZIndex = useBoardStore((state) => state.cardZIndexById);
  const cardZIndexById = initialCardZIndexById ?? storeCardZIndex;
  const bringCardToFront = useBoardStore((state) => state.bringCardToFront);
  const storeIsClearConfirmOpen = useBoardStore((state) => state.isClearConfirmOpen);
  const isClearConfirmOpen = initialClearConfirmOpen ?? storeIsClearConfirmOpen;

  const [viewport, setViewport] = useState<Viewport>(() =>
    initialViewportScale !== undefined ? { ...initialViewport, scale: initialViewportScale } : initialViewport,
  );
  const viewportRef = useRef<Viewport>(viewport);
  useLayoutEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);
  const [boardSize, setBoardSize] = useState<Size>({ width: 0, height: 0 });
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [pinchState, setPinchState] = useState<PinchState | null>(null);
  const [cardDragState, setCardDragState] = useState<CardDragState | null>(initialCardDragState ?? null);
  const [isGesturing, setIsGesturing] = useState(false);
  const [hoveredSlotId, setHoveredSlotId] = useState<string | null>(null);
  /**
   * The dragged card is over somewhere it can be dropped — a timeline slot, the timeline panel
   * itself, or the discard bin. Drives the pill. Reset on every drag end and cancel, because a
   * stale `true` would leave the next drag invisible.
   */
  const [isOverDropZone, setIsOverDropZone] = useState(initialIsOverDropZone ?? false);
  const [cardHeightsById, setCardHeightsById] = useState<Record<string, number>>({});
  const [discardingCardId, setDiscardingCardId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(initialConfirmation ?? null);
  /**
   * Three separate expansion states, because they are three different promises to the user and
   * conflating them leaks one into another. It did: with hover and drag sharing one flag, a plain
   * hover showed the *drag* hint — "press Esc to minimize" — to somebody holding no card.
   *
   *   isTimelineExpanded       pinned: clicked, or a card was docked into it
   *   isDragTimelineExpanded   a card in hand is near the timeline
   *   isTimelinePreviewed      the pointer is resting on the collapsed control
   */
  const [isTimelineExpanded, setIsTimelineExpanded] = useState(initialTimelineExpanded ?? false);
  const [isDragTimelineExpanded, setIsDragTimelineExpanded] = useState(initialHoverExpanded ?? false);
  /** Previewed open: the pointer is resting on the collapsed control. Collapses again on leave. */
  const [isTimelinePreviewed, setIsTimelinePreviewed] = useState(false);
  const [isTourOpen, setIsTourOpen] = useState(() => {
    if (initialTourOpen !== undefined) {
      return initialTourOpen;
    }
    try {
      return localStorage.getItem(TOUR_STORAGE_KEY) !== 'true';
    } catch {
      return true;
    }
  });
  const [settlingSlotId, setSettlingSlotId] = useState<string | null>(null);
  const [dragParticles, setDragParticles] = useState<DragParticle[]>([]);
  const [autoFitEnabled, setAutoFitEnabled] = useState(true);
  /** The deal in flight, or null. Non-null drives `.board__cards--dealing`. */
  const [deal, setDeal] = useState<ActiveDeal | null>(null);
  const [interactionMode, setInteractionMode] = useState<BoardInteractionMode>(initialInteractionMode ?? 'grab');
  const [isModeDropdownOpen, setIsModeDropdownOpen] = useState(initialModeDropdownOpen ?? false);
  const [wheelPosition, setWheelPosition] = useState<Point | null>(initialWheelPosition ?? null);
  const [hoveredWheelMode, setHoveredWheelMode] = useState<BoardInteractionMode | null>(null);
  const [inspectedCardId, setInspectedCardId] = useState<string | null>(initialInspectedCardId ?? null);
  const storeViewMode = useBoardStore((state) => state.viewMode);
  const setViewMode = useBoardStore((state) => state.setViewMode);
  const [viewModeState, setViewModeState] = useState<ViewMode>(initialViewMode ?? storeViewMode);
  const viewMode = initialViewMode !== undefined ? viewModeState : storeViewMode;

  const handleSwitchView = useCallback(
    (mode: ViewMode) => {
      setViewMode(mode);
      if (initialViewMode !== undefined) {
        setViewModeState(mode);
      }
    },
    [initialViewMode, setViewMode],
  );

  const lastPointerTypeRef = useRef<string>('mouse');
  const wheelMouseEnteredRef = useRef(false);

  const handleCloseTour = useCallback(() => {
    setIsTourOpen(false);
    try {
      localStorage.setItem(TOUR_STORAGE_KEY, 'true');
    } catch {
      // Ignore localStorage restrictions
    }
  }, []);

  const handleOpenTour = useCallback(() => {
    setIsTourOpen(true);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && (wheelPosition !== null || isModeDropdownOpen)) {
        event.preventDefault();
        setWheelPosition(null);
        setHoveredWheelMode(null);
        setIsModeDropdownOpen(false);
        return;
      }
      if (event.key === '?' && !isTourOpen) {
        const target = event.target as HTMLElement | null;
        const isInput =
          target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
        if (!isInput) {
          event.preventDefault();
          handleOpenTour();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleOpenTour, isModeDropdownOpen, isTourOpen, wheelPosition]);

  useLayoutEffect(() => {
    cardDragStateRef.current = cardDragState;
  }, [cardDragState]);

  const dockedCardIds = useMemo(
    () => new Set(timelineSlots.map((slot) => slot.activityId).filter((id): id is string => Boolean(id))),
    [timelineSlots],
  );

  const boardLayout = useMemo(
    () =>
      computeBoardLayout({
        cards,
        discardedCards,
        dockedCardIds,
        customPositions: cardPositionsById,
        measuredHeights: cardHeightsById,
      }),
    [cards, discardedCards, dockedCardIds, cardPositionsById, cardHeightsById],
  );

  const canvasCards = boardLayout.canvasCards;

  const researchCardPosition = useMemo(
    () => (canvasCards.length > 0 ? findBestSquareSlot('standard', canvasCards) : tiledCardPosition(0)),
    [canvasCards],
  );

  useEffect(() => {
    setTimelineSlots(TIMELINE_SLOTS.map((slot) => ({ ...slot, activityId: null })));
    void loadAgentResponse({ query: INITIAL_ACTIVITY_QUERY, mode: 'demo' });
  }, [loadAgentResponse, setTimelineSlots]);

  // The confirmation is a transient status, not a permanent fixture on the board.
  useEffect(() => {
    if (!confirmation) {
      return;
    }

    const timer = window.setTimeout(() => setConfirmation(null), CONFIRMATION_MS);

    return () => window.clearTimeout(timer);
  }, [confirmation]);

  // Escape key closes clear board confirmation dialog if open
  useEffect(() => {
    if (!isClearConfirmOpen) {
      return;
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        cancelClearBoard();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isClearConfirmOpen, cancelClearBoard]);

  /** Records that the user has taken over the viewport, so auto-framing stops for good. */
  const markAdjusted = useCallback(() => {
    hasAdjustedRef.current = true;
  }, []);

  const fitContent = useCallback(
    (maxScale = 1.0) => {
      const width =
        boardSize.width || previousSizeRef.current.width || boardRef.current?.clientWidth || window.innerWidth || 0;
      const height =
        boardSize.height || previousSizeRef.current.height || boardRef.current?.clientHeight || window.innerHeight || 0;

      if (width <= 0 || height <= 0 || canvasCards.length === 0) {
        return;
      }

      const bounds = contentBounds(canvasCards);
      contentBoundsRef.current = bounds;
      setViewport(fitViewport(bounds, { x: 0, y: 0, width, height }, BOARD_FIT_PADDING, maxScale));
    },
    [boardSize.height, boardSize.width, canvasCards],
  );

  /**
   * Cancels a deal in flight and every timer belonging to it.
   *
   * Used when the user takes over: picking a card up, or clearing the board, must drop the
   * choreography rather than fight it. A card that is mid-flight snaps to its resting position,
   * which is honest — the deal was an invitation, not a state the board is stuck in.
   */
  const cancelDeal = useCallback(() => {
    dealRunIdRef.current += 1;
    if (dealStartTimerRef.current !== null) {
      window.clearTimeout(dealStartTimerRef.current);
      dealStartTimerRef.current = null;
    }
    if (dealEndTimerRef.current !== null) {
      window.clearTimeout(dealEndTimerRef.current);
      dealEndTimerRef.current = null;
    }
    setDeal(null);
  }, []);

  /**
   * Schedules a deal from the pile over the next `DEAL_DURATION_MS`.
   *
   * `placed` is the set of cards being dealt and `tiledPlaced` is where each of them is going.
   * Both are needed here rather than recomputed from state, because React has not committed the
   * new positions yet when this is called and reading them back would get the old ones.
   */
  const startDeal = useCallback(
    (placed: readonly PlacedBoardCard<BoardActivityCard>[], tiledPlaced: readonly PlacedCard[]) => {
      if (dealStartTimerRef.current !== null) {
        window.clearTimeout(dealStartTimerRef.current);
        dealStartTimerRef.current = null;
      }
      if (dealEndTimerRef.current !== null) {
        window.clearTimeout(dealEndTimerRef.current);
        dealEndTimerRef.current = null;
      }

      if (placed.length === 0 || prefersReducedMotion()) {
        // Reduced motion is not "the same animation, faster". The deal is a way of *placing*
        // the cards, so without it the cards are simply placed.
        dealRunIdRef.current += 1;
        setDeal(null);
        return;
      }

      const steps = dealTiming(placed.length);
      const deck = dealDeckOrigin(tiledPlaced);
      const placements: Record<string, DealPlacement> = {};

      placed.forEach((card, index) => {
        const id = card.card.activity.id;
        const at = tiledPlaced[index].position;
        const step = steps[index];
        placements[id] = {
          ...step,
          fromX: deck.x - at.x,
          fromY: deck.y - at.y,
          // A fixed, deterministic fan: the pile reads as a hand of cards rather than as
          // noise, and the same board always deals the same way.
          tiltDeg: ((index % 5) - 2) * DEAL_TILT_DEG,
          stack: placed.length - index,
        };
      });

      dealRunIdRef.current += 1;
      const runId = dealRunIdRef.current;
      const count = placed.length;

      dealStartTimerRef.current = window.setTimeout(() => {
        dealStartTimerRef.current = null;
        if (dealRunIdRef.current !== runId) {
          return;
        }
        setDeal({ runId, placements, count });
        dealEndTimerRef.current = window.setTimeout(() => {
          dealEndTimerRef.current = null;
          setDeal((current) => (current?.runId === runId ? null : current));
        }, DEAL_DURATION_MS);
      }, BOARD_FRAME_SETTLE_MS);
    },
    [],
  );

  /**
   * Auto-tile: re-pack every canvas card, re-frame onto the result, and deal the cards in.
   *
   * The fit and the deal are two separate beats rather than one. The camera move tells the user
   * *where* the board went; the deal then tells them *what happened to the cards*. Running both
   * at once meant the first fifth of the deal played against a moving board.
   *
   * Every geometric decision stays in `boardLayout.ts`: which slot each card takes, where the
   * pile sits, and how long it all takes. This function only decides *when*.
   */
  const runAutoTile = useCallback(
    (placed: readonly PlacedBoardCard<BoardActivityCard>[], options: { reframe: boolean }) => {
      if (placed.length === 0) {
        return;
      }

      const positions = autoTileBoard(placed, { origin: BOARD_GRID_ORIGIN });
      const tiledPlaced = placed.map((card) => placedCardAt(card, positions[card.card.activity.id] ?? card.position));

      setCardPositions(positions);

      if (options.reframe) {
        const width =
          boardSize.width || previousSizeRef.current.width || boardRef.current?.clientWidth || window.innerWidth || 0;
        const height =
          boardSize.height ||
          previousSizeRef.current.height ||
          boardRef.current?.clientHeight ||
          window.innerHeight ||
          0;
        if (width > 0 && height > 0) {
          const bounds = contentBounds(tiledPlaced);
          contentBoundsRef.current = bounds;
          setViewport(fitViewport(bounds, { x: 0, y: 0, width, height }, BOARD_FIT_PADDING, 1.0));
        }
      }

      startDeal(placed, tiledPlaced);
    },
    [boardSize.height, boardSize.width, setCardPositions, startDeal],
  );

  const handleAutoTile = useCallback(() => {
    runAutoTile(canvasCards, { reframe: autoFitEnabled });
  }, [autoFitEnabled, canvasCards, runAutoTile]);

  useEffect(() => {
    return () => {
      if (dealStartTimerRef.current !== null) {
        window.clearTimeout(dealStartTimerRef.current);
      }
      if (dealEndTimerRef.current !== null) {
        window.clearTimeout(dealEndTimerRef.current);
      }
    };
  }, []);

  // Observe the board element rather than `window`: resizing the window must not throw
  // away the user's pan and zoom.
  useLayoutEffect(() => {
    const element = boardRef.current;

    if (!element) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];

      if (!entry) {
        return;
      }

      const { width, height } = entry.contentRect;
      setBoardSize((current) => (current.width === width && current.height === height ? current : { width, height }));
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  const cardIdsKey = cards.map((c) => c.activity.id).join(',');

  // Measure rendered heights of canvas cards to drive content-driven layout and collision avoidance
  useLayoutEffect(() => {
    const container = boardRef.current;
    if (!container || typeof ResizeObserver === 'undefined') {
      return;
    }

    const cardElements = container.querySelectorAll<HTMLElement>('[data-activity-card-id]');
    if (cardElements.length === 0) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const updates: Record<string, number> = {};
      for (const entry of entries) {
        const id = entry.target.getAttribute('data-activity-card-id');
        if (id) {
          const height = Math.round(entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height);
          if (height > 0) {
            updates[id] = height;
          }
        }
      }
      if (Object.keys(updates).length > 0) {
        setCardHeightsById((prev) => {
          let changed = false;
          for (const [k, v] of Object.entries(updates)) {
            // Ignore minor subpixel rounding (<3px) caused by browser zoom
            if (Math.abs((prev[k] ?? 0) - v) > 3) {
              changed = true;
              break;
            }
          }
          return changed ? { ...prev, ...updates } : prev;
        });
      }
    });

    cardElements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [cardIdsKey]);

  // Resizing must not throw away their pan and zoom: hold the centre point.
  useEffect(() => {
    if (boardSize.width <= 0 || boardSize.height <= 0) {
      return;
    }

    const previousSize = previousSizeRef.current;
    previousSizeRef.current = boardSize;

    if (previousSize.width > 0 && previousSize.height > 0) {
      setViewport((current) => preserveViewportCenter(current, previousSize, boardSize));
    }
  }, [boardSize]);

  // Unified framing effect: frames on initial card load, and when autoFitEnabled is true for search additions or out-of-frame drops
  useEffect(() => {
    const cardsToFrame: PlacedCard[] = [...canvasCards];
    if (agentStatus === 'searching') {
      cardsToFrame.push({
        position: researchCardPosition,
        variant: 'standard',
      });
    }
    contentBoundsRef.current = contentBounds(cardsToFrame);

    if (cardsToFrame.length === 0) {
      return;
    }

    const cardsAdded = cards.length > previousCardsLengthRef.current;
    previousCardsLengthRef.current = cards.length;

    // The opening deal owns the first framing. Until it has run, leave the camera alone —
    // otherwise this effect would frame the board against `computeBoardLayout`'s organic
    // placement, and the deal would then re-frame it against the tiled one a frame later.
    if (!initialFramedRef.current) {
      return;
    }

    const outOfFrame = areAnyCardsOutOfFrame(cardsToFrame, viewportRef.current, boardSize);

    if (autoFitEnabled && (cardsAdded || (cardJustLandedRef.current && outOfFrame))) {
      fitContent(1.0);
    }
    cardJustLandedRef.current = false;
  }, [agentStatus, autoFitEnabled, boardSize, canvasCards, cards.length, fitContent, researchCardPosition]);

  /**
   * The opening beat: auto-tile the board and deal the cards onto it.
   *
   * Gated on the measurement pass above, because auto-tile packs by height and packing by
   * `calculateContentCardHeight`'s first-paint estimate leaves a 9-unit gap where a 40-unit one
   * was asked for on the shipped seed data — and the positions it writes are then pinned by
   * `customPositions`, so an error here would be permanent rather than transient. Waiting one
   * ResizeObserver round costs a frame and makes the deal animate the layout the board is
   * actually going to keep.
   *
   * The fallback timer is not belt-and-braces, it is the only path on a browser that never
   * reports: without it a board could load, be measured by nothing, and simply never deal. It
   * re-reads `canvasCards` from the closure of the render that armed it, which is the same list
   * the observer is watching.
   */
  useEffect(() => {
    if (initialFramedRef.current || canvasCards.length === 0) {
      return;
    }

    const begin = () => {
      if (initialFramedRef.current) {
        return;
      }
      initialFramedRef.current = true;
      runAutoTile(canvasCards, { reframe: true });
    };

    if (canvasCards.every((card) => (cardHeightsById[card.card.activity.id] ?? 0) > 0)) {
      begin();
      return;
    }

    const timer = window.setTimeout(begin, CARD_MEASURE_FALLBACK_MS);

    return () => window.clearTimeout(timer);
  }, [canvasCards, cardHeightsById, runAutoTile]);

  // Continuous particle bleed emitter while dragging: continuously drops glowing stardust
  const isDraggingAnyCard = Boolean(cardDragState);
  useEffect(() => {
    if (!isDraggingAnyCard) {
      return;
    }

    const bleedInterval = window.setInterval(() => {
      const currentDrag = cardDragStateRef.current;
      if (!currentDrag) {
        return;
      }
      const { screenPoint, grabOffset, source } = currentDrag;
      const isTimeline = source === 'timeline';
      const scale = isTimeline ? 1 : viewport.scale;
      const cardW = (isTimeline ? 176 : CARD_WIDTH) * scale;
      const cardH = (isTimeline ? 120 : CARD_MIN_HEIGHT) * scale;
      const cardLeft = screenPoint.x - grabOffset.x;
      const cardTop = screenPoint.y - grabOffset.y;

      const count = Math.random() > 0.35 ? 3 : 2;
      const newParticles: DragParticle[] = [];
      for (let i = 0; i < count; i++) {
        particleIdRef.current += 1;
        const palette = particleColors();
        const color = palette[Math.floor(Math.random() * palette.length)];
        const size = Math.floor(Math.random() * 5) + 3; // 3 to 7px
        const dx = (Math.random() - 0.5) * 26;
        const dy = Math.random() * 24 + 10;
        newParticles.push({
          id: particleIdRef.current,
          x: cardLeft + Math.random() * cardW,
          y: cardTop + cardH * (0.65 + Math.random() * 0.4),
          size,
          color,
          dx,
          dy,
        });
      }
      setDragParticles((prev) => [...prev.slice(-36), ...newParticles]);
    }, 60);

    return () => window.clearInterval(bleedInterval);
  }, [isDraggingAnyCard, viewport.scale]);

  const markGesture = useCallback(() => {
    setIsGesturing(true);

    if (gestureTimerRef.current !== null) {
      window.clearTimeout(gestureTimerRef.current);
    }

    gestureTimerRef.current = window.setTimeout(() => {
      gestureTimerRef.current = null;
      setIsGesturing(false);
    }, GESTURE_SETTLE_MS);
  }, [setIsGesturing]);

  useEffect(
    () => () => {
      if (gestureTimerRef.current !== null) {
        window.clearTimeout(gestureTimerRef.current);
      }
      if (particleCleanupTimerRef.current !== null) {
        window.clearTimeout(particleCleanupTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    function handleGlobalKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        if (cardDragState) {
          setIsTimelineExpanded(false);
          setIsDragTimelineExpanded(false);
          userCollapsedDuringDragRef.current = true;
        } else if (isTimelineExpanded) {
          setIsTimelineExpanded(false);
        } else if (isTimelinePreviewed) {
          // Escape is the keyboard route out of the hover preview, for the same reason the
          // minimise button is: leaving the timeline open is not a state worth being trapped in.
          setIsTimelinePreviewed(false);
        }
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [cardDragState, isTimelineExpanded, isTimelinePreviewed]);

  // React registers `wheel` passively at the root, so `preventDefault()` from an
  // onWheel handler is ignored. Only a native non-passive listener keeps the page from
  // scrolling while zooming.
  useEffect(() => {
    const element = boardRef.current;

    if (!element) {
      return;
    }

    const handleNativeWheel = (event: globalThis.WheelEvent) => {
      if (cardDragStateRef.current !== null) {
        return;
      }

      const screenPoint = screenPointWithin(element.getBoundingClientRect(), event.clientX, event.clientY);

      event.preventDefault();
      markGesture();
      markAdjusted();
      setViewport((current) =>
        zoomAtScreenPoint(
          current,
          screenPoint,
          current.scale * (event.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP),
        ),
      );
    };

    element.addEventListener('wheel', handleNativeWheel, { passive: false });

    return () => element.removeEventListener('wheel', handleNativeWheel);
  }, [markAdjusted, markGesture]);

  const boardStyle = useMemo(
    () =>
      ({
        '--board-grid-size': `${BOARD_GRID_SIZE * viewport.scale}px`,
        '--board-pan-x': `${viewport.x}px`,
        '--board-pan-y': `${viewport.y}px`,
        '--board-zoom': viewport.scale,
        '--card-min-height': `${CARD_MIN_HEIGHT}px`,
        '--card-width': `${CARD_WIDTH}px`,
      }) as CSSProperties,
    [viewport],
  );

  /* ------------------------------------------------------- timeline hover intent */

  /**
   * The collapsed timeline is a preview on hover and a pin on click.
   *
   * That split is the whole answer to "hover must expand it without the usual hover problems",
   * and it is only safe because of one geometric fact: **the collapsed panel's rect is
   * contained in the expanded panel's rect.** Both are anchored to `bottom: var(--space-5)`,
   * and the expanded one is both wider and taller, so growing never ejects the pointer from
   * under itself. That rules out the classic expand/shrink oscillation, and it means the only
   * way back to collapsed is a pointer that has genuinely left.
   *
   * The three failure modes that remain are handled by three separate decisions:
   *
   *  - **accidental trigger** — the panel sits in the bottom-left of the board, right where a
   *    user reaches for a card, so opening takes a `TIMELINE_HOVER_EXPAND_MS` dwell rather
   *    than happening on entry;
   *  - **flicker** — leaving takes `TIMELINE_HOVER_COLLAPSE_MS`, deliberately longer than
   *    entering, so crossing the boundary while heading for a slot is not read as a decision;
   *  - **pointer escape** — handled above, by containment rather than by a timer.
   *
   * Hover is a mouse affordance and never the only route: the collapsed control is a real
   * button that a keyboard user activates, which *pins* the timeline open. Focus alone
   * deliberately does not expand — a tab-through that opened the panel would move the panel
   * out from under the tab order on every pass.
   */
  const clearTimelineHoverTimers = useCallback(() => {
    if (hoverExpandTimerRef.current !== null) {
      window.clearTimeout(hoverExpandTimerRef.current);
      hoverExpandTimerRef.current = null;
    }
    if (hoverCollapseTimerRef.current !== null) {
      window.clearTimeout(hoverCollapseTimerRef.current);
      hoverCollapseTimerRef.current = null;
    }
  }, []);

  const cancelHoverCollapse = useCallback(() => {
    if (hoverCollapseTimerRef.current !== null) {
      window.clearTimeout(hoverCollapseTimerRef.current);
      hoverCollapseTimerRef.current = null;
    }
  }, []);

  const requestHoverExpand = useCallback(() => {
    // Pinned open: hover has nothing to add, and must not be able to close it either.
    if (isTimelineExpanded) {
      return;
    }
    clearTimelineHoverTimers();
    hoverExpandTimerRef.current = window.setTimeout(() => {
      hoverExpandTimerRef.current = null;
      setIsTimelinePreviewed(true);
    }, TIMELINE_HOVER_EXPAND_MS);
  }, [clearTimelineHoverTimers, isTimelineExpanded]);

  const requestHoverCollapse = useCallback(() => {
    // Pinned open, or a card in hand is holding the panel open on its own account. In both cases
    // this preview owns nothing and must not touch either state.
    if (isTimelineExpanded || cardDragState) {
      return;
    }
    clearTimelineHoverTimers();
    hoverCollapseTimerRef.current = window.setTimeout(() => {
      hoverCollapseTimerRef.current = null;
      setIsTimelinePreviewed(false);
    }, TIMELINE_HOVER_COLLAPSE_MS);
  }, [cardDragState, clearTimelineHoverTimers, isTimelineExpanded]);

  useEffect(() => clearTimelineHoverTimers, [clearTimelineHoverTimers]);

  function screenPointFromClient(clientX: number, clientY: number): Point | null {
    const bounds = boardRef.current?.getBoundingClientRect();

    return bounds ? screenPointWithin(bounds, clientX, clientY) : null;
  }

  function boardCentre(): Point {
    return { x: boardSize.width / 2, y: boardSize.height / 2 };
  }

  function isTouchOrPhoneDevice(): boolean {
    if (lastPointerTypeRef.current === 'touch') {
      return true;
    }
    if (typeof window !== 'undefined') {
      if (window.matchMedia?.('(pointer: coarse)')?.matches) {
        return true;
      }
      if (window.innerWidth <= 720) {
        return true;
      }
    }
    return false;
  }

  function closeModeWheel() {
    setWheelPosition(null);
    setHoveredWheelMode(null);
    wheelMouseEnteredRef.current = false;
  }

  function handleBoardContextMenu(event: MouseEvent<HTMLDivElement>) {
    if (isTouchOrPhoneDevice()) {
      return;
    }

    if (
      event.target instanceof Element &&
      (event.target.closest('.timeline') ||
        event.target.closest('.discard-bin') ||
        event.target.closest('.board-toolbar') ||
        event.target.closest('.board-mode-control') ||
        event.target.closest('.board-modal'))
    ) {
      return;
    }

    event.preventDefault();
    const bounds = boardRef.current?.getBoundingClientRect();
    const rawPoint = bounds ? screenPointWithin(bounds, event.clientX, event.clientY) : { x: 240, y: 240 };
    const width = bounds?.width || boardSize.width || 800;
    const height = bounds?.height || boardSize.height || 600;
    const pad = 128;
    const clampedPoint: Point = {
      x: Math.min(Math.max(rawPoint.x, pad), Math.max(pad, width - pad)),
      y: Math.min(Math.max(rawPoint.y, pad), Math.max(pad, height - pad)),
    };
    setIsModeDropdownOpen(false);
    wheelMouseEnteredRef.current = true;
    setHoveredWheelMode(null);
    setWheelPosition(clampedPoint);
  }

  function handleToggleModeDropdown() {
    closeModeWheel();
    setIsModeDropdownOpen((prev) => !prev);
  }

  function selectInteractionMode(mode: BoardInteractionMode) {
    setInteractionMode(mode);
    setIsModeDropdownOpen(false);
    closeModeWheel();
    if (mode !== 'inspect') {
      setInspectedCardId(null);
    }
    const option = MODE_OPTIONS.find((item) => item.id === mode);
    if (option) {
      setConfirmation(boardModeSelectedConfirmation(option.label));
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    lastPointerTypeRef.current = event.pointerType || 'mouse';

    if (event.button === 2) {
      return;
    }

    if (isModeDropdownOpen && event.target instanceof Element && !event.target.closest('.board-mode-control')) {
      setIsModeDropdownOpen(false);
    }

    if (
      wheelPosition &&
      event.target instanceof Element &&
      !event.target.closest('.board-wheel') &&
      !event.target.closest('.board-mode-control')
    ) {
      closeModeWheel();
    }

    if (
      event.target instanceof Element &&
      ((interactionMode === 'grab' && event.target.closest('[data-activity-card]')) ||
        event.target.closest('button') ||
        event.target.closest('a') ||
        event.target.closest('[data-timeline-slot]') ||
        event.target.closest('.timeline') ||
        event.target.closest('.discard-bin') ||
        event.target.closest('.board-toolbar') ||
        event.target.closest('.board-wheel') ||
        event.target.closest('.board-mode-control') ||
        event.target.closest('.board-modal'))
    ) {
      return;
    }

    const screenPoint = screenPointFromClient(event.clientX, event.clientY);
    if (!screenPoint) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointersRef.current.set(event.pointerId, screenPoint);
    const activePointers = [...activePointersRef.current.values()];

    if (activePointers.length === 1) {
      setDragState({ pointerId: event.pointerId, screenPoint });
      markGesture();
      markAdjusted();
      return;
    }

    if (activePointers.length === 2) {
      const [firstPointer, secondPointer] = activePointers;
      const midpoint = midpointBetween(firstPointer, secondPointer);
      setDragState(null);
      setPinchState({
        distance: distanceBetween(firstPointer, secondPointer),
        screenPoint: midpoint,
        viewport,
      });
      markGesture();
      markAdjusted();
    }
  }

  function handleCardPointerDown(event: PointerEvent<HTMLElement>, card: BoardActivityCard, from?: { slotId: string }) {
    if (event.button === 2) {
      return;
    }

    if (!from && interactionMode !== 'grab') {
      if (interactionMode === 'inspect') {
        setInspectedCardId(card.activity.id);
      }
      return;
    }

    if (event.target instanceof Element && (event.target.closest('button') || event.target.closest('a'))) {
      return;
    }

    const boardBounds = boardRef.current?.getBoundingClientRect();
    const cardBounds = event.currentTarget.getBoundingClientRect();
    if (!boardBounds) {
      return;
    }

    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Ignored in test runners or environments where pointer capture is unsupported
    }
    markGesture();
    markAdjusted();
    const cardId = card.activity.id;
    bringCardToFront(cardId);
    if (!from) {
      const currentPos = cardPositionsById[cardId] ?? boardLayout.positionsById[cardId];
      if (currentPos && !cardPositionsById[cardId]) {
        setCardPosition(cardId, currentPos);
      }
    }

    userCollapsedDuringDragRef.current = false;
    // A deal is an invitation, not a state the board is stuck in: the moment the user picks
    // something up, the choreography gets out of the way.
    cancelDeal();
    clearTimelineHoverTimers();
    const screenPoint = screenPointWithin(boardBounds, event.clientX, event.clientY);
    setCardDragState({
      card,
      cardSize: {
        width: cardBounds.width,
        height: cardBounds.height,
      },
      source: from ? 'timeline' : 'board',
      fromSlotId: from?.slotId,
      pointerId: event.pointerId,
      screenPoint,
      grabOffset: {
        x: event.clientX - cardBounds.left,
        y: event.clientY - cardBounds.top,
      },
      trail: [screenPoint],
    });
  }

  function handleCardPointerMove(event: PointerEvent<HTMLElement>) {
    if (!cardDragState || cardDragState.pointerId !== event.pointerId) {
      return;
    }

    if (event.buttons === 0) {
      handleCardPointerUp(event);
      return;
    }

    const boardBounds = boardRef.current?.getBoundingClientRect();
    if (!boardBounds) {
      return;
    }

    const screenPoint = screenPointWithin(boardBounds, event.clientX, event.clientY);
    setCardDragState((prev) => {
      if (!prev) return null;
      const trail = [screenPoint, ...(prev.trail ?? [])].slice(0, 4);
      return { ...prev, screenPoint, trail };
    });

    const isTimeline = cardDragState.source === 'timeline';
    const scale = isTimeline ? 1 : viewport.scale;
    const cardW = cardDragState.cardSize?.width ?? (isTimeline ? 176 : CARD_WIDTH) * scale;
    const cardH = cardDragState.cardSize?.height ?? (isTimeline ? 120 : CARD_MIN_HEIGHT) * scale;
    const cardLeft = screenPoint.x - cardDragState.grabOffset.x;
    const cardTop = screenPoint.y - cardDragState.grabOffset.y;

    // Drop stardust particles behind the dragging card
    const count = Math.random() > 0.4 ? 2 : 1;
    const newParticles: DragParticle[] = [];
    for (let i = 0; i < count; i++) {
      particleIdRef.current += 1;
      const palette = particleColors();
      const color = palette[Math.floor(Math.random() * palette.length)];
      const size = Math.floor(Math.random() * 5) + 3;
      const dx = (Math.random() - 0.5) * 24;
      const dy = Math.random() * 22 + 8;
      newParticles.push({
        id: particleIdRef.current,
        x: cardLeft + Math.random() * cardW,
        y: cardTop + Math.random() * cardH,
        size,
        color,
        dx,
        dy,
      });
    }
    setDragParticles((prev) => [...prev.slice(-36), ...newParticles]);

    // One hit-test per move, reused for the slot, the panel and the discard bin. Three separate
    // `elementFromPoint` calls meant the pill could disagree with the highlight it is meant to
    // uncover, because two of them could land on different frames of a moving pointer.
    //
    // `.board__drag` is `pointer-events: none`, so this never reports the card in hand.
    const hit = typeof document !== 'undefined' ? document.elementFromPoint(event.clientX, event.clientY) : null;
    const slotId = hit?.closest<HTMLElement>('[data-timeline-slot]')?.dataset.timelineSlot;
    setHoveredSlotId(slotId ?? null);

    const overTimeline = Boolean(hit?.closest('.timeline'));
    const overDiscardBin = isOverDiscardBin(event.clientX, event.clientY);
    // The card gets out of the way over the *whole* drop area, not only over a slot: the
    // timeline's own padding and header are the parts a user crosses on the way to a slot.
    setIsOverDropZone(Boolean(slotId) || overTimeline || overDiscardBin);

    const timelineElement = typeof document !== 'undefined' ? document.querySelector<HTMLElement>('.timeline') : null;
    let nearTimeline = false;
    if (timelineElement) {
      if (overTimeline) {
        nearTimeline = true;
      } else {
        const bounds = timelineElement.getBoundingClientRect();
        const proximityPadding = isDragTimelineExpanded ? 8 : 50;
        const cursorNear =
          event.clientX >= bounds.left - proximityPadding &&
          event.clientX <= bounds.right + proximityPadding &&
          event.clientY >= bounds.top - proximityPadding &&
          event.clientY <= bounds.bottom + proximityPadding;

        const cardClientLeft = boardBounds.left + cardLeft;
        const cardClientTop = boardBounds.top + cardTop;
        const cardClientRight = cardClientLeft + cardW;
        const cardClientBottom = cardClientTop + cardH;
        const cardNear =
          cardClientRight >= bounds.left - proximityPadding &&
          cardClientLeft <= bounds.right + proximityPadding &&
          cardClientBottom >= bounds.top - proximityPadding &&
          cardClientTop <= bounds.bottom + proximityPadding;

        nearTimeline = cursorNear || cardNear;
      }
    }

    if (!userCollapsedDuringDragRef.current && !isTimelineExpanded) {
      setIsDragTimelineExpanded(nearTimeline);
    }
  }

  function isOverDiscardBin(clientX: number, clientY: number): boolean {
    const bounds = discardBinRef.current?.getBoundingClientRect();

    return Boolean(
      bounds && clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom,
    );
  }

  function handleCardPointerUp(event: PointerEvent<HTMLElement>) {
    // The drag releases the timeline; the hover preview owns itself and is left alone.
    setIsDragTimelineExpanded(false);
    setIsOverDropZone(false);
    userCollapsedDuringDragRef.current = false;

    if (!cardDragState || cardDragState.pointerId !== event.pointerId) {
      return;
    }

    const { card, source, fromSlotId, screenPoint, grabOffset } = cardDragState;
    const cardId = card.activity.id;

    const slotElement = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-timeline-slot]');
    const slotId = slotElement?.dataset.timelineSlot;

    if (slotId) {
      const matchingSlotId = getActivityMatchingSlotId(card.activity.parts[0]?.start);
      if (matchingSlotId && matchingSlotId !== slotId) {
        const expectedSlot = TIMELINE_SLOTS.find((definition) => definition.id === matchingSlotId);
        setConfirmation(timelineSlotMismatchMessage(expectedSlot?.label ?? matchingSlotId));
        if (source === 'board') {
          const originalCardPos = cardPositionsById[cardId] ?? boardLayout.positionsById[cardId];
          if (originalCardPos) {
            setCardPosition(cardId, originalCardPos);
          }
        }
      } else {
        if (source === 'board') {
          const originalCardPos = cardPositionsById[cardId] ?? boardLayout.positionsById[cardId];
          if (originalCardPos) {
            setCardPosition(cardId, originalCardPos);
          }
        }

        const targetSlot = timelineSlots.find((s) => s.id === slotId);
        const replacedCardId =
          targetSlot?.activityId && targetSlot.activityId !== cardId ? targetSlot.activityId : null;

        if (replacedCardId) {
          const displacedCard = cards.find((c) => c.activity.id === replacedCardId);
          const originalReplacedPos = cardPositionsById[replacedCardId] ?? boardLayout.positionsById[replacedCardId];
          if (originalReplacedPos) {
            setCardPosition(replacedCardId, originalReplacedPos);
          }

          if (displacedCard) {
            const displacedTitle = displacedCard.activity.title_en ?? displacedCard.activity.title;
            setConfirmation(timelineActivityReplacedConfirmation(displacedTitle));
          }
        } else {
          const slotDef = TIMELINE_SLOTS.find((definition) => definition.id === slotId);
          if (slotDef) {
            setConfirmation(timelineActivityDockedConfirmation(slotDef.label));
          }
        }

        setIsTimelineExpanded(true);
        dockCard(cardId, slotId, { replace: true });
        setSettlingSlotId(slotId);
        window.setTimeout(() => setSettlingSlotId((current) => (current === slotId ? null : current)), 1000);
      }
    } else if (isOverDiscardBin(event.clientX, event.clientY)) {
      if (source === 'timeline' && fromSlotId) {
        undockCard(fromSlotId);
      }
      setDiscardingCardId(cardId);
      window.setTimeout(() => {
        discardCard(cardId);
        setDiscardingCardId(null);
      }, CARD_DISCARD_DURATION_MS);
    } else {
      const isOverTimeline = Boolean(document.elementFromPoint(event.clientX, event.clientY)?.closest('.timeline'));
      if (isOverTimeline) {
        if (source === 'board') {
          const originalCardPos = cardPositionsById[cardId] ?? boardLayout.positionsById[cardId];
          if (originalCardPos) {
            setCardPosition(cardId, originalCardPos);
          }
        }
      } else {
        if (source === 'timeline' && fromSlotId) {
          undockCard(fromSlotId);
        }
        const cardScreenPoint = {
          x: screenPoint.x - grabOffset.x,
          y: screenPoint.y - grabOffset.y,
        };
        const newPos = screenToWorld(cardScreenPoint, viewport);
        setCardPosition(cardId, newPos);
        cardJustLandedRef.current = true;
      }
    }

    setCardDragState(null);
    setHoveredSlotId(null);

    if (particleCleanupTimerRef.current !== null) {
      window.clearTimeout(particleCleanupTimerRef.current);
    }
    particleCleanupTimerRef.current = window.setTimeout(() => {
      setDragParticles([]);
      particleCleanupTimerRef.current = null;
    }, 600);
  }

  const cancelCardDrag = useCallback(() => {
    setIsDragTimelineExpanded(false);
    setIsOverDropZone(false);
    userCollapsedDuringDragRef.current = false;
    setCardDragState(null);
    setHoveredSlotId(null);

    if (particleCleanupTimerRef.current !== null) {
      window.clearTimeout(particleCleanupTimerRef.current);
    }
    particleCleanupTimerRef.current = window.setTimeout(() => {
      setDragParticles([]);
      particleCleanupTimerRef.current = null;
    }, 600);
  }, []);

  function handleCardPointerCancel(event: PointerEvent<HTMLElement>) {
    if (cardDragState?.pointerId === event.pointerId) {
      cancelCardDrag();
    }
  }

  function handleCardLostPointerCapture(event: PointerEvent<HTMLElement>) {
    if (cardDragState?.pointerId === event.pointerId) {
      cancelCardDrag();
    }
  }

  // Window fallback: ensure drag state is cleaned up if pointer capture is revoked or lost
  useEffect(() => {
    if (!cardDragState) {
      return;
    }

    const pointerId = cardDragState.pointerId;

    const handleWindowPointerMove = (event: globalThis.PointerEvent) => {
      if (event.pointerId === pointerId && event.buttons === 0) {
        cancelCardDrag();
      }
    };

    const handleWindowPointerCancel = (event: globalThis.PointerEvent) => {
      if (event.pointerId === pointerId) {
        cancelCardDrag();
      }
    };

    const handleWindowBlur = () => {
      cancelCardDrag();
    };

    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointercancel', handleWindowPointerCancel);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointercancel', handleWindowPointerCancel);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [cardDragState, cancelCardDrag]);

  async function handleFindSimilar(card: BoardActivityCard) {
    const title = card.activity.title_en ?? card.activity.title;
    const success = await findSimilar(card);
    if (success) {
      setConfirmation(findSimilarConfirmation(title));
    } else {
      const state = useBoardStore.getState();
      if (state.agentStatus !== 'error') {
        setConfirmation(findSimilarExhaustedConfirmation(title));
      }
    }
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const screenPoint = screenPointFromClient(event.clientX, event.clientY);
    if (!screenPoint) {
      return;
    }

    if (
      wheelPosition &&
      wheelMouseEnteredRef.current &&
      (event.pointerType === 'mouse' || !event.pointerType) &&
      distanceBetween(screenPoint, wheelPosition) > 128
    ) {
      closeModeWheel();
    }

    activePointersRef.current.set(event.pointerId, screenPoint);
    const activePointers = [...activePointersRef.current.values()];

    if (pinchState && activePointers.length === 2) {
      const [firstPointer, secondPointer] = activePointers;
      setViewport(
        pinchViewport(
          pinchState.viewport,
          pinchState.screenPoint,
          midpointBetween(firstPointer, secondPointer),
          distanceBetween(firstPointer, secondPointer) / pinchState.distance,
        ),
      );
      return;
    }

    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    setViewport((currentViewport) =>
      panViewport(currentViewport, {
        x: screenPoint.x - dragState.screenPoint.x,
        y: screenPoint.y - dragState.screenPoint.y,
      }),
    );
    setDragState({ ...dragState, screenPoint });
  }

  function stopDragging(event: PointerEvent<HTMLDivElement>) {
    activePointersRef.current.delete(event.pointerId);
    const activePointers = [...activePointersRef.current.entries()];

    if (event.pointerId === dragState?.pointerId) {
      setDragState(null);
    }

    if (pinchState) {
      setPinchState(null);
      const [remainingPointer] = activePointers;
      if (remainingPointer) {
        const [pointerId, screenPoint] = remainingPointer;
        setDragState({ pointerId, screenPoint });
      }
    }
  }

  function stepZoom(direction: 1 | -1) {
    markAdjusted();
    setViewport((current) => {
      const next = nextZoomLevel(current.scale, direction);

      return next === current.scale ? current : zoomAtScreenPoint(current, boardCentre(), next);
    });
  }

  function resetZoom() {
    markAdjusted();
    const width =
      boardSize.width || previousSizeRef.current.width || boardRef.current?.clientWidth || window.innerWidth || 0;
    const height =
      boardSize.height || previousSizeRef.current.height || boardRef.current?.clientHeight || window.innerHeight || 0;

    const cardRects = canvasCards.map((c) => ({
      x: c.position.x,
      y: c.position.y,
      width: CARD_WIDTH,
      height: cardHeightsById[c.card.activity.id] ?? CARD_MIN_HEIGHT,
    }));
    setViewport((current) => smartCenter100(current, cardRects, { width, height }));
  }

  function handleBoardKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Only when the canvas itself holds focus, so a focused button keeps its own keys.
    if (event.target !== event.currentTarget) {
      return;
    }

    const panStep = event.shiftKey ? KEYBOARD_PAN_STEP_FAST : KEYBOARD_PAN_STEP;
    const panKeys: Record<string, Point> = {
      ArrowDown: { x: 0, y: panStep },
      ArrowLeft: { x: panStep, y: 0 },
      ArrowRight: { x: -panStep, y: 0 },
      ArrowUp: { x: 0, y: -panStep },
    };
    const pan = panKeys[event.key];

    if (pan) {
      event.preventDefault();
      markAdjusted();
      setViewport((current) => panViewport(current, pan));
      return;
    }

    switch (event.key) {
      case '+':
      case '=':
        event.preventDefault();
        stepZoom(1);
        break;
      case '-':
      case '_':
        event.preventDefault();
        stepZoom(-1);
        break;
      case '0':
        event.preventDefault();
        fitContent();
        break;
      case '1':
        event.preventDefault();
        resetZoom();
        break;
      case 't':
      case 'T':
        event.preventDefault();
        handleAutoTile();
        break;
      default:
        break;
    }
  }

  const isTimelineVisible = isTimelineExpanded || isDragTimelineExpanded || isTimelinePreviewed;
  const dockedCount = timelineSlots.filter((slot) => Boolean(slot.activityId)).length;
  const activeMatchingSlotId = cardDragState
    ? getActivityMatchingSlotId(cardDragState.card.activity.parts[0]?.start)
    : null;

  const hoveredOccupiedSlot = hoveredSlotId
    ? timelineSlots.find((s) => s.id === hoveredSlotId && Boolean(s.activityId))
    : null;
  const isReplacingHoveredSlot = Boolean(
    hoveredOccupiedSlot &&
    cardDragState &&
    hoveredOccupiedSlot.activityId !== cardDragState.card.activity.id &&
    (!activeMatchingSlotId || activeMatchingSlotId === hoveredOccupiedSlot.id),
  );
  const hoveredExistingCard =
    isReplacingHoveredSlot && hoveredOccupiedSlot?.activityId
      ? cards.find((c) => c.activity.id === hoveredOccupiedSlot.activityId)
      : null;

  /**
   * The serial the pill carries.
   *
   * Taken from the full card list even when the card is being dragged *out of* a timeline slot,
   * because the docked card is the one view that has no serial of its own and the pill still has
   * to name the thing the user is carrying. `activityCardSerial` is the same function the card's
   * own plate uses, so the two can never drift.
   */
  const draggedCardSerial = cardDragState
    ? activityCardSerial(
        Math.max(
          0,
          cards.findIndex((c) => c.activity.id === cardDragState.card.activity.id),
        ),
      )
    : null;
  const isDragProxyPill = Boolean(cardDragState && isOverDropZone);
  const activeModeOption = MODE_OPTIONS.find((item) => item.id === interactionMode) ?? MODE_OPTIONS[0];
  const ActiveModeIcon = activeModeOption.Icon;

  const isInspectZoomActive = Math.round(viewport.scale * 100) <= INSPECT_MAX_ZOOM_PERCENT;
  const inspectedPlaced =
    interactionMode === 'inspect' && isInspectZoomActive && inspectedCardId
      ? (canvasCards.find((entry) => entry.card.activity.id === inspectedCardId) ?? null)
      : null;
  const inspectedSerialIndex = inspectedPlaced
    ? cards.findIndex((candidate) => candidate.activity.id === inspectedPlaced.card.activity.id)
    : -1;
  const inspectedGeometry = useMemo(() => {
    if (!inspectedPlaced) {
      return null;
    }
    const cardCenterX = viewport.x + (inspectedPlaced.position.x + CARD_WIDTH / 2) * viewport.scale;
    const cardTopY = viewport.y + inspectedPlaced.position.y * viewport.scale;
    const cardHeight = cardHeightsById[inspectedPlaced.card.activity.id] ?? CARD_MIN_HEIGHT;
    const cardBottomY = viewport.y + (inspectedPlaced.position.y + cardHeight) * viewport.scale;
    const below = cardTopY < 130;
    const clampedX =
      boardSize.width > 0 ? Math.min(Math.max(cardCenterX, 176), Math.max(176, boardSize.width - 176)) : cardCenterX;
    return {
      left: Math.round(clampedX),
      top: Math.round(below ? cardBottomY : cardTopY),
      below,
    };
  }, [boardSize.width, cardHeightsById, inspectedPlaced, viewport.scale, viewport.x, viewport.y]);

  return (
    <main className="app">
      <header className="app__header">
        <div className="app__header-brand">
          <h1>{HEADING}</h1>
          <p>{TAGLINE}</p>
        </div>
        <div className="app__header-search" data-tour-anchor="search">
          <SearchBar />
        </div>
        <div className="app__header-actions" data-tour-anchor="view-switcher">
          <nav aria-label={VIEW_SWITCHER_LABEL} className="view-switcher" role="tablist">
            <button
              aria-selected={viewMode === 'board'}
              className={`view-switcher__btn${viewMode === 'board' ? ' view-switcher__btn--active' : ''}`}
              onClick={() => handleSwitchView('board')}
              role="tab"
              title={VIEW_MODE_BOARD_TOOLTIP}
              type="button"
            >
              <IconBoardView />
              <span>{VIEW_MODE_BOARD_LABEL}</span>
            </button>
            <button
              aria-selected={viewMode === 'deck'}
              className={`view-switcher__btn${viewMode === 'deck' ? ' view-switcher__btn--active' : ''}`}
              onClick={() => handleSwitchView('deck')}
              role="tab"
              title={VIEW_MODE_DECK_TOOLTIP}
              type="button"
            >
              <IconDeckView />
              <span>{VIEW_MODE_DECK_LABEL}</span>
            </button>
          </nav>
        </div>
      </header>
      <AgentStatusPanel status={agentStatus} />
      <p className="sr-only" id="board-keyboard-hint">
        {BOARD_KEYBOARD_HINT}
      </p>
      {viewMode === 'deck' ? (
        <DeckView
          cards={cards}
          onFindSimilar={findSimilar}
          onSwitchToBoard={() => handleSwitchView('board')}
          timelineSlots={timelineSlots}
        />
      ) : (
        <div
          aria-describedby="board-keyboard-hint"
          aria-keyshortcuts={BOARD_KEYBOARD_SHORTCUTS}
          aria-label={BOARD_LABEL}
          className={`board board--mode-${interactionMode}${dragState || pinchState ? ' board--dragging' : ''}${
            isGesturing ? ' board--gesturing' : ''
          }`}
          onContextMenu={handleBoardContextMenu}
          onKeyDown={handleBoardKeyDown}
          onPointerCancel={stopDragging}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDragging}
          ref={boardRef}
          role="region"
          style={boardStyle}
          tabIndex={0}
        >
          {!isTimelineVisible ? (
            /**
             * The collapsed summary is a real disclosure button, and it stays the keyboard route
             * into the timeline now that hover is one too: hover previews, activation pins. The
             * `aria-label` is the accessible name and `aria-expanded` is the state, neither of
             * which the visible content provides — the hint text below is decoration on top of
             * the name, and it names all three ways in (hover, click, drop).
             */
            <button
              aria-expanded={false}
              aria-label={TIMELINE_EXPAND_LABEL}
              className="timeline timeline--collapsed"
              data-tour-anchor="timeline"
              onBlur={requestHoverCollapse}
              onClick={() => {
                clearTimelineHoverTimers();
                setIsTimelineExpanded(true);
              }}
              onPointerEnter={requestHoverExpand}
              onPointerLeave={requestHoverCollapse}
              type="button"
            >
              <div className="timeline__collapsed-content">
                <div className="timeline__collapsed-header">
                  <span className="timeline__collapsed-badge">
                    {timelinePlannedCount(dockedCount, TIMELINE_SLOTS.length)}
                  </span>
                  <strong>{TIMELINE_COLLAPSED_LABEL}</strong>
                </div>
                <p className="timeline__collapsed-hint">{TIMELINE_COLLAPSED_HINT}</p>
              </div>
            </button>
          ) : (
            /**
             * Enter and leave are both needed here, and only leave is obvious. `onPointerEnter`
             * exists to cancel a collapse the pointer is already inside the effect of undoing:
             * moving from the timeline's edge to a slot must not read as leaving and coming back.
             */
            <section
              aria-label={TIMELINE_LABEL}
              className={`timeline timeline--expanded${
                isDragTimelineExpanded ? ' timeline--hover-expanded' : isTimelinePreviewed ? ' timeline--preview' : ''
              }`}
              data-tour-anchor="timeline"
              onPointerEnter={cancelHoverCollapse}
              onPointerLeave={requestHoverCollapse}
            >
              {isReplacingHoveredSlot && hoveredExistingCard ? (
                <div className="timeline__guide-hint timeline__replace-toast board__toast">
                  {timelineSlotReplaceAlert(
                    hoveredExistingCard.activity.title_en ?? hoveredExistingCard.activity.title,
                  )}
                </div>
              ) : isDragTimelineExpanded ? (
                /* Drag-only. Offering "press Esc to minimize" to somebody who is only hovering
                 would be offering to undo something they never did. */
                <div className="timeline__guide-hint board__toast">{TIMELINE_DRAG_COLLAPSE_HINT}</div>
              ) : null}
              <div className="timeline__header">
                <div className="timeline__header-left">
                  <h2>{TIMELINE_LABEL}</h2>
                  <span className="timeline__count-badge">
                    {timelinePlannedCount(dockedCount, TIMELINE_SLOTS.length)}
                  </span>
                </div>
                <button
                  aria-expanded={true}
                  aria-label={TIMELINE_COLLAPSE_LABEL}
                  className="timeline__minimize-button"
                  onClick={() => {
                    setIsTimelineExpanded(false);
                    setIsDragTimelineExpanded(false);
                    setIsTimelinePreviewed(false);
                    clearTimelineHoverTimers();
                    userCollapsedDuringDragRef.current = true;
                  }}
                  title={TIMELINE_COLLAPSE_LABEL}
                  type="button"
                >
                  &minus;
                </button>
              </div>
              <div className="timeline__slots">
                {timelineSlots.map((slot) => {
                  const match = cards.find((candidate) => candidate.activity.id === slot.activityId);
                  const isDraggingThisCard = cardDragState?.card.activity.id === match?.activity.id;
                  const isSuggested = activeMatchingSlotId === slot.id;
                  const isHovered = hoveredSlotId === slot.id;
                  const isReplacingThisSlot = isHovered && isReplacingHoveredSlot;
                  const isIncompatibleHover =
                    isHovered && activeMatchingSlotId !== null && activeMatchingSlotId !== slot.id;

                  let slotClass = 'timeline__slot';
                  if (isReplacingThisSlot) {
                    slotClass += ' timeline__slot--replacing';
                  } else {
                    if (isSuggested) slotClass += ' timeline__slot--suggested';
                    if (isHovered && !isIncompatibleHover) slotClass += ' timeline__slot--dragover';
                    if (isIncompatibleHover) slotClass += ' timeline__slot--incompatible';
                  }
                  if (match) {
                    slotClass += ' timeline__slot--docked';
                  }
                  if (settlingSlotId === slot.id) {
                    slotClass += ' timeline__slot--settling';
                  }

                  return (
                    <div aria-live="polite" className={slotClass} data-timeline-slot={slot.id} key={slot.id}>
                      <div className="timeline__slot-header">
                        <span>{TIMELINE_SLOTS.find((definition) => definition.id === slot.id)?.label}</span>
                        {match ? (
                          <button
                            aria-label={UNDOCK_CARD_LABEL}
                            className="btn btn--sm btn--icon timeline__slot-remove"
                            onClick={() => undockCard(slot.id)}
                            type="button"
                          >
                            &times;
                          </button>
                        ) : null}
                      </div>
                      {match ? (
                        <div
                          className={`timeline__docked-card${isDraggingThisCard ? ' timeline__docked-card--ghost' : ''}`}
                          draggable={false}
                          onDragStart={(event) => event.preventDefault()}
                          onLostPointerCapture={handleCardLostPointerCapture}
                          onPointerCancel={handleCardPointerCancel}
                          onPointerDown={(event) => handleCardPointerDown(event, match, { slotId: slot.id })}
                          onPointerMove={handleCardPointerMove}
                          onPointerUp={handleCardPointerUp}
                        >
                          <ActivityCard match={match} size="docked" state="spawning" />
                        </div>
                      ) : (
                        <div className="timeline__slot-empty">{TIMELINE_SLOT_EMPTY}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
          <aside
            aria-label={DISCARD_BIN_LABEL}
            className={`discard-bin${cardDragState ? ' discard-bin--active' : ''}`}
            ref={discardBinRef}
          >
            <strong>{DISCARD_BIN_LABEL}</strong>
            <span>{DISCARD_BIN_HINT}</span>
          </aside>
          <div className="board-mode-control" data-tour-anchor="mode">
            <button
              aria-expanded={isModeDropdownOpen}
              aria-haspopup="menu"
              aria-label={`${BOARD_MODE_TRIGGER_LABEL} (${boardModeActiveLabel(activeModeOption.label)})`}
              className={`board-mode-trigger${
                interactionMode !== 'grab' || isModeDropdownOpen ? ' board-mode-trigger--active' : ''
              }`}
              onClick={handleToggleModeDropdown}
              title={`${BOARD_MODE_TRIGGER_LABEL} — ${activeModeOption.hint}`}
              type="button"
            >
              <ActiveModeIcon />
              <span className="board-mode-trigger__label">{activeModeOption.label}</span>
            </button>
            {isModeDropdownOpen ? (
              <div aria-label={BOARD_MODE_DROPDOWN_LABEL} className="board-mode-dropdown" role="menu">
                {MODE_OPTIONS.map((option) => {
                  const OptionIcon = option.Icon;
                  const isSelected = interactionMode === option.id;
                  return (
                    <button
                      aria-checked={isSelected}
                      className={`board-mode-dropdown__option${isSelected ? ' board-mode-dropdown__option--active' : ''}`}
                      key={option.id}
                      onClick={() => selectInteractionMode(option.id)}
                      role="menuitemradio"
                      type="button"
                    >
                      <OptionIcon />
                      <span>{option.label}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          {wheelPosition ? (
            <div
              aria-label={BOARD_MODE_WHEEL_LABEL}
              className="board-wheel"
              onPointerEnter={(event) => {
                if (event.pointerType === 'mouse' || !event.pointerType) {
                  wheelMouseEnteredRef.current = true;
                }
              }}
              onPointerLeave={(event) => {
                setHoveredWheelMode(null);
                if (event.pointerType === 'mouse' || !event.pointerType) {
                  closeModeWheel();
                }
              }}
              role="menu"
              style={{ left: wheelPosition.x, top: wheelPosition.y }}
            >
              <div aria-hidden="true" className="board-wheel__ring" />
              <svg aria-hidden="true" className="board-wheel__sectors" viewBox="0 0 240 240">
                <defs>
                  <radialGradient cx="50%" cy="50%" id="wheel-grad-idle" r="50%">
                    <stop offset="30%" stopColor="var(--card-hover)" stopOpacity="0.22" />
                    <stop offset="100%" stopColor="var(--chrome)" stopOpacity="0.58" />
                  </radialGradient>
                  <radialGradient cx="50%" cy="50%" id="wheel-grad-active" r="50%">
                    <stop offset="25%" stopColor="var(--accent-soft)" stopOpacity="0.45" />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.32" />
                  </radialGradient>
                  <radialGradient cx="50%" cy="50%" id="wheel-grad-hover" r="50%">
                    <stop offset="20%" stopColor="var(--accent-soft)" stopOpacity="0.65" />
                    <stop offset="100%" stopColor="var(--accent-strong)" stopOpacity="0.46" />
                  </radialGradient>
                </defs>
                {MODE_OPTIONS.map((option) => {
                  const isHovered = hoveredWheelMode === option.id;
                  const isSelected = interactionMode === option.id;
                  const fillUrl = isHovered
                    ? 'url(#wheel-grad-hover)'
                    : isSelected
                      ? 'url(#wheel-grad-active)'
                      : 'url(#wheel-grad-idle)';
                  return (
                    <path
                      className={`board-wheel__sector${
                        isHovered ? ' board-wheel__sector--hover' : isSelected ? ' board-wheel__sector--active' : ''
                      }`}
                      d={option.sectorPath}
                      fill={fillUrl}
                      key={option.id}
                    />
                  );
                })}
                <line className="board-wheel__divider" x1="95.75" x2="17.81" y1="106" y2="61" />
                <line className="board-wheel__divider" x1="144.25" x2="222.19" y1="106" y2="61" />
                <line className="board-wheel__divider" x1="120" x2="120" y1="148" y2="238" />
                <circle className="board-wheel__rim" cx="120" cy="120" r="118" />
                <circle className="board-wheel__rim" cx="120" cy="120" r="28" />
              </svg>
              <button
                aria-label={BOARD_MODE_WHEEL_CLOSE_LABEL}
                className="board-wheel__hub"
                onClick={closeModeWheel}
                type="button"
              >
                <IconClose />
              </button>
              {MODE_OPTIONS.map((option) => {
                const OptionIcon = option.Icon;
                const isSelected = interactionMode === option.id;
                return (
                  <button
                    aria-checked={isSelected}
                    className={`board-wheel__option ${option.posClass}${
                      isSelected ? ' board-wheel__option--active' : ''
                    }`}
                    key={option.id}
                    onBlur={() => setHoveredWheelMode(null)}
                    onClick={() => selectInteractionMode(option.id)}
                    onFocus={() => setHoveredWheelMode(option.id)}
                    onPointerEnter={() => setHoveredWheelMode(option.id)}
                    onPointerLeave={() => setHoveredWheelMode(null)}
                    role="menuitemradio"
                    type="button"
                  >
                    <span className="board-wheel__option-content">
                      <OptionIcon />
                      <span>{option.label}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
          {inspectedPlaced && inspectedGeometry ? (
            <div
              aria-label={BOARD_INSPECT_CALLOUT_LABEL}
              aria-live="polite"
              className={`board-inspect${inspectedGeometry.below ? ' board-inspect--below' : ''}`}
              role="status"
              style={{
                left: inspectedGeometry.left,
                top: inspectedGeometry.top,
              }}
            >
              <div className="board-inspect__meta">
                {inspectedSerialIndex >= 0 ? (
                  <span className="board-inspect__serial">{activityCardSerial(inspectedSerialIndex)}</span>
                ) : null}
                {inspectedPlaced.card.activity.location.district ? (
                  <span className="board-inspect__district">{inspectedPlaced.card.activity.location.district}</span>
                ) : null}
              </div>
              <p className="board-inspect__title">
                {inspectedPlaced.card.activity.title_en ?? inspectedPlaced.card.activity.title}
              </p>
              {inspectedPlaced.card.activity.title_en &&
              inspectedPlaced.card.activity.title_en !== inspectedPlaced.card.activity.title ? (
                <p className="board-inspect__subtitle">{inspectedPlaced.card.activity.title}</p>
              ) : null}
            </div>
          ) : null}
          <BoardToolbar
            autoFitEnabled={autoFitEnabled}
            canAutoTile={canvasCards.length > 0}
            canClearBoard={cards.length > 0 || timelineSlots.some((s) => Boolean(s.activityId))}
            canFitContent={canvasCards.length > 0}
            canResetZoom={Math.abs(viewport.scale - 1) >= 0.001}
            canZoomIn={canZoomIn(viewport.scale)}
            canZoomOut={canZoomOut(viewport.scale)}
            isDragging={Boolean(cardDragState)}
            onAutoTile={handleAutoTile}
            onClearBoard={requestClearBoard}
            onFitContent={() => fitContent(1.0)}
            onOpenHelp={handleOpenTour}
            onResetZoom={resetZoom}
            onToggleAutoFit={setAutoFitEnabled}
            onZoomIn={() => stepZoom(1)}
            onZoomOut={() => stepZoom(-1)}
            scale={viewport.scale}
          />
          {cards.length === 0 && agentStatus !== 'searching' ? (
            <div className="board__layer board__layer--center">
              <div className="board__panel">
                <h2>{BOARD_GUIDE_TITLE}</h2>
                <p>{BOARD_GUIDE_BODY}</p>
                <p>{BOARD_EMPTY_STATE}</p>
              </div>
            </div>
          ) : null}
          {confirmation ? (
            <div className="board__layer board__layer--top">
              <p aria-live="polite" className="board__toast" role="status">
                {confirmation}
              </p>
            </div>
          ) : null}
          {cardDragState ? (
            /**
             * The proxy is the *same card*, not a simplified stand-in.
             *
             * It used to render `<ActivityCard>` with no `index` and no `onFindSimilar`, which made
             * the serial plate and the Find similar button vanish from the DOM — and because the
             * card's height is content-driven (DESIGN.md), the card you were carrying came up 45
             * world units shorter than the one you picked it up from, at the exact moment you are
             * looking at it to aim. Removing the elements was the bug; dimming them was never
             * asked for. Both props are passed so the proxy's box is the card's box by construction,
             * at every board zoom, and any future change to the card's anatomy carries into the drag
             * for free.
             *
             * `inert` is what makes rendering the real controls safe here: the proxy must not
             * contribute a second tab stop or a second "Find similar" to the accessibility tree
             * while the real card is still on the board underneath it. It changes nothing about
             * layout or paint — `.board__drag` is already `pointer-events: none`.
             *
             * The pill is a **sibling** of the card, not a state of it, and that is the whole
             * reconciliation with the layout-stability guarantee above. While the pointer is over
             * a drop zone the card cross-fades to a small serial pill so the slot highlight it is
             * aimed at becomes visible — but the card is not scaled down, not re-rendered and not
             * given fewer props. It stays at full size with every element in the DOM and loses
             * only its **opacity**, so the proxy's layout box is the card's layout box in every
             * state of the drag, not merely at rest. The pill is `position: absolute`, so it is
             * out of flow and cannot contribute to that box even by accident.
             *
             * Under `prefers-reduced-motion` the cross-fade snaps; the pill still appears, because
             * getting the card out of the way is information, not decoration.
             */
            <div
              className={`board__drag${cardDragState.source === 'timeline' ? ' board__drag--docked' : ''}${
                isDragProxyPill ? ' board__drag--pill' : ''
              }`}
              inert
              style={{
                left: cardDragState.screenPoint.x - cardDragState.grabOffset.x,
                top: cardDragState.screenPoint.y - cardDragState.grabOffset.y,
              }}
            >
              <div className="board__drag-scale">
                <ActivityCard
                  index={
                    cardDragState.source === 'timeline'
                      ? undefined
                      : cards.findIndex((c) => c.activity.id === cardDragState.card.activity.id)
                  }
                  isRecent={recentCardIds.includes(cardDragState.card.activity.id)}
                  match={cardDragState.card}
                  onFindSimilar={cardDragState.source === 'timeline' ? undefined : handleFindSimilar}
                  size={cardDragState.source === 'timeline' ? 'docked' : 'canvas'}
                  state="dragging"
                  variant={
                    boardLayout.variantsById[cardDragState.card.activity.id] ?? getCardVariant(cardDragState.card)
                  }
                />
              </div>
              {draggedCardSerial ? (
                <span
                  aria-hidden="true"
                  className="board__drag-pill"
                  style={{
                    left: cardDragState.grabOffset.x,
                    top: cardDragState.grabOffset.y,
                  }}
                >
                  {draggedCardSerial}
                </span>
              ) : null}
            </div>
          ) : null}
          {dragParticles.length > 0 ? (
            <div aria-hidden="true" className="board__drag-particles">
              {dragParticles.map((particle) => (
                <div
                  className="board__drag-particle"
                  key={particle.id}
                  style={
                    {
                      left: particle.x,
                      top: particle.y,
                      width: `${particle.size}px`,
                      height: `${particle.size}px`,
                      backgroundColor: particle.color,
                      color: particle.color,
                      '--p-dx': `${particle.dx}px`,
                      '--p-dy': `${particle.dy}px`,
                    } as CSSProperties
                  }
                />
              ))}
            </div>
          ) : null}
          <div className="board__pan">
            <div className="board__world">
              <div className={`board__cards${deal ? ' board__cards--dealing' : ''}`}>
                {agentStatus === 'searching' ? (
                  <div
                    className="board__card board__card--research"
                    data-research-card
                    style={{ left: researchCardPosition.x, top: researchCardPosition.y }}
                  >
                    <ResearchCard />
                  </div>
                ) : null}
                {canvasCards.map(({ card: match, position, variant }, index) => {
                  const isDragging = cardDragState?.card.activity.id === match.activity.id;
                  const isDiscarding = discardingCardId === match.activity.id;
                  const isInspected =
                    interactionMode === 'inspect' && isInspectZoomActive && inspectedCardId === match.activity.id;
                  const cardZ = cardZIndexById[match.activity.id] ?? 1;
                  // The serial is the card's index in the *full* list, not in `canvasCards`, so
                  // docking or discarding a card never renumbers the ones that stay.
                  const serialIndex = cards.findIndex((candidate) => candidate.activity.id === match.activity.id);
                  const placement = deal?.placements[match.activity.id];

                  return (
                    <div
                      className={`board__card board__card--${variant}${isDragging ? ' board__card--ghost' : ''}${
                        placement ? ' board__card--dealing' : ''
                      }${isInspected ? ' board__card--inspected' : ''}`}
                      data-activity-card
                      data-activity-card-id={match.activity.id}
                      data-card-z={cardZ}
                      data-tour-anchor={index === 0 ? 'card' : undefined}
                      draggable={false}
                      key={match.activity.id}
                      onDragStart={(event) => event.preventDefault()}
                      onLostPointerCapture={handleCardLostPointerCapture}
                      onPointerCancel={handleCardPointerCancel}
                      onPointerDown={(event) => handleCardPointerDown(event, match)}
                      onPointerEnter={() => {
                        if (interactionMode === 'inspect') {
                          setInspectedCardId(match.activity.id);
                        }
                      }}
                      onPointerLeave={() => {
                        if (interactionMode === 'inspect') {
                          setInspectedCardId((current) => (current === match.activity.id ? null : current));
                        }
                      }}
                      onPointerMove={handleCardPointerMove}
                      onPointerUp={handleCardPointerUp}
                      style={
                        {
                          left: position.x,
                          top: position.y,
                          zIndex: placement ? placement.stack : cardZ,
                          '--card-z': cardZ,
                          // `left`/`top` are the card's *final* slot for the whole deal. Only
                          // these offsets and the two durations are per-card, and all of them come
                          // from `dealTiming()`, so the stylesheet contains no timing of its own.
                          ...(placement
                            ? {
                                '--deal-from-x': `${placement.fromX}px`,
                                '--deal-from-y': `${placement.fromY}px`,
                                '--deal-tilt': `${placement.tiltDeg}deg`,
                                '--deal-stack': placement.stack,
                                '--deal-delay': `${placement.delayMs}ms`,
                                '--deal-travel': `${placement.travelMs}ms`,
                              }
                            : null),
                        } as CSSProperties
                      }
                    >
                      <ActivityCard
                        index={serialIndex}
                        isRecent={recentCardIds.includes(match.activity.id)}
                        match={match}
                        onFindSimilar={handleFindSimilar}
                        state={isDiscarding ? 'discarding' : 'spawning'}
                        variant={variant}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
      {isClearConfirmOpen ? (
        <div
          aria-describedby="clear-board-desc"
          aria-labelledby="clear-board-title"
          aria-modal="true"
          className="board-modal-backdrop"
          onClick={cancelClearBoard}
          role="alertdialog"
        >
          <div className="board-modal" onClick={(event) => event.stopPropagation()}>
            <h2 id="clear-board-title">{CLEAR_BOARD_CONFIRM_TITLE}</h2>
            <p id="clear-board-desc">{CLEAR_BOARD_CONFIRM_MESSAGE}</p>
            <div className="board-modal__actions">
              <button autoFocus className="btn btn--sm" onClick={cancelClearBoard} type="button">
                {CLEAR_BOARD_CANCEL_ACTION}
              </button>
              <button
                className="btn btn--sm btn--danger"
                onClick={() => {
                  confirmClearBoard();
                  hasAdjustedRef.current = false;
                  // Re-arm the opening deal: a cleared board is a fresh board, and the cards
                  // that come back should be dealt onto it rather than appearing already tiled.
                  initialFramedRef.current = false;
                  cancelDeal();
                }}
                type="button"
              >
                {CLEAR_BOARD_CONFIRM_ACTION}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <ProductTour isOpen={isTourOpen} onClose={handleCloseTour} />
      <AgentAccessKeyModal />
    </main>
  );
}

function screenPointWithin(bounds: DOMRect, clientX: number, clientY: number): Point {
  return {
    x: clientX - bounds.left,
    y: clientY - bounds.top,
  };
}

function distanceBetween(first: Point, second: Point): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function midpointBetween(first: Point, second: Point): Point {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  };
}
