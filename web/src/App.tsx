import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ActivityCard } from './ActivityCard';
import { AgentStatusPanel } from './AgentStatusPanel';
import { ResearchCard } from './ResearchCard';
import { SearchBar } from './SearchBar';
import {
  BOARD_EMPTY_STATE,
  BOARD_GUIDE_BODY,
  BOARD_GUIDE_TITLE,
  BOARD_KEYBOARD_HINT,
  BOARD_KEYBOARD_SHORTCUTS,
  BOARD_LABEL,
  AUTO_FIT_LABEL,
  AUTO_FIT_DESCRIPTION,
  DISCARD_BIN_HINT,
  DISCARD_BIN_LABEL,
  DISCARD_GUIDE_TOAST,
  FIT_VIEW_LABEL,
  HEADING,
  INITIAL_ACTIVITY_QUERY,
  RESET_ZOOM_LABEL,
  TAGLINE,
  TIMELINE_COLLAPSE_LABEL,
  TIMELINE_COLLAPSED_HINT,
  TIMELINE_COLLAPSED_LABEL,
  TIMELINE_DRAG_COLLAPSE_HINT,
  TIMELINE_EXPAND_LABEL,
  TIMELINE_GUIDE_TOAST,
  TIMELINE_LABEL,
  TIMELINE_SLOT_EMPTY,
  TIMELINE_SLOTS,
  UNDOCK_CARD_LABEL,
  ZOOM_CONTROL_LABEL,
  ZOOM_IN_LABEL,
  ZOOM_OUT_LABEL,
  findSimilarConfirmation,
  timelineActivityReplacedConfirmation,
  timelineActivityDockedConfirmation,
  timelinePlannedCount,
  timelineSlotMismatchMessage,
  timelineSlotReplaceAlert,
  zoomPercentage,
} from './copy';
import {
  BOARD_FIT_PADDING,
  BOARD_GRID_SIZE,
  CARD_DISCARD_DURATION_MS,
  CARD_MIN_HEIGHT,
  CARD_WIDTH,
  type PlacedCard,
  areAnyCardsOutOfFrame,
  computeBoardLayout,
  contentBounds,
  findBestSquareSlot,
  getActivityMatchingSlotId,
  getCardVariant,
  tiledCardPosition,
} from './boardLayout';
import {
  type ActivityCard as BoardActivityCard,
  type AgentStatus,
  type TimelineSlot,
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
  zoomAtScreenPoint,
} from './viewport';

/** Zoom ratio applied per notch of a scroll wheel or trackpad. */
const WHEEL_ZOOM_STEP = 1.15;
/** How long after the last wheel event the viewport stops counting as "gesturing". */
const GESTURE_SETTLE_MS = 160;
/** How long the "looking for similar activities" confirmation stays on the board. */
const CONFIRMATION_MS = 4000;
/** How long the initial floating hints are displayed above docks. */
const GUIDE_HINTS_MS = 8000;

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

type CardDragState = {
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

const PARTICLE_COLORS = ['#38bdf8', '#818cf8', '#c084fc', '#f472b6', '#e0e7ff', '#34d399'];

export type AppProps = {
  agentStatus?: AgentStatus;
  cards?: BoardActivityCard[];
  initialConfirmation?: string;
  initialHoverExpanded?: boolean;
  initialTimelineExpanded?: boolean;
  timelineSlots?: TimelineSlot[];
};

export function App({
  agentStatus: propAgentStatus,
  cards: propCards,
  initialConfirmation,
  initialHoverExpanded,
  initialTimelineExpanded,
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

  const [viewport, setViewport] = useState<Viewport>(initialViewport);
  const [boardSize, setBoardSize] = useState<Size>({ width: 0, height: 0 });
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [pinchState, setPinchState] = useState<PinchState | null>(null);
  const [cardDragState, setCardDragState] = useState<CardDragState | null>(null);
  const [isGesturing, setIsGesturing] = useState(false);
  const [hoveredSlotId, setHoveredSlotId] = useState<string | null>(null);
  const [cardPositionsById, setCardPositionsById] = useState<Record<string, Point>>({});
  const [discardingCardId, setDiscardingCardId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(initialConfirmation ?? null);
  const [isTimelineExpanded, setIsTimelineExpanded] = useState(initialTimelineExpanded ?? false);
  const [isHoverExpanded, setIsHoverExpanded] = useState(initialHoverExpanded ?? false);
  const [showGuideHints, setShowGuideHints] = useState(true);
  const [settlingSlotId, setSettlingSlotId] = useState<string | null>(null);
  const [dragParticles, setDragParticles] = useState<DragParticle[]>([]);
  const [autoFitEnabled, setAutoFitEnabled] = useState(true);

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
      }),
    [cards, discardedCards, dockedCardIds, cardPositionsById],
  );

  const canvasCards = boardLayout.canvasCards;

  const researchCardPosition = useMemo(
    () => (canvasCards.length > 0 ? findBestSquareSlot('standard', canvasCards) : tiledCardPosition(0)),
    [canvasCards],
  );

  useEffect(() => {
    setTimelineSlots(TIMELINE_SLOTS.map((slot) => ({ ...slot, activityId: null })));
    void loadAgentResponse({ query: INITIAL_ACTIVITY_QUERY });
  }, [loadAgentResponse, setTimelineSlots]);

  // 5-second floating guide hint timer for timeline and discard bin
  useEffect(() => {
    const timer = window.setTimeout(() => setShowGuideHints(false), GUIDE_HINTS_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // The confirmation is a transient status, not a permanent fixture on the board.
  useEffect(() => {
    if (!confirmation) {
      return;
    }

    const timer = window.setTimeout(() => setConfirmation(null), CONFIRMATION_MS);

    return () => window.clearTimeout(timer);
  }, [confirmation]);

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

  // One-time initial load framing: automatically fits the cards once on initial load as soon as cards arrive on the board
  useEffect(() => {
    if (initialFramedRef.current || canvasCards.length === 0) {
      return;
    }

    const width = boardSize.width || boardRef.current?.clientWidth || window.innerWidth || 0;
    const height = boardSize.height || boardRef.current?.clientHeight || window.innerHeight || 0;

    if (width > 0 && height > 0) {
      const bounds = contentBounds(canvasCards);
      contentBoundsRef.current = bounds;
      setViewport(fitViewport(bounds, { x: 0, y: 0, width, height }, BOARD_FIT_PADDING, 1.0));
      initialFramedRef.current = true;
    }
  }, [boardSize.height, boardSize.width, canvasCards]);

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

    const outOfFrame = areAnyCardsOutOfFrame(cardsToFrame, viewport, boardSize);

    // When autoFitEnabled is TRUE:
    // - New cards are added from search queries
    // - A card was just landed (dropped) and any card is out of the frame
    if (autoFitEnabled && (cardsAdded || (cardJustLandedRef.current && outOfFrame))) {
      fitContent(1.0);
    }
    cardJustLandedRef.current = false;
  }, [agentStatus, autoFitEnabled, boardSize, canvasCards, cards.length, fitContent, researchCardPosition, viewport]);

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
        const color = PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)];
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
          setIsHoverExpanded(false);
          userCollapsedDuringDragRef.current = true;
        } else if (isTimelineExpanded) {
          setIsTimelineExpanded(false);
        }
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [cardDragState, isTimelineExpanded]);

  // React registers `wheel` passively at the root, so `preventDefault()` from an
  // onWheel handler is ignored. Only a native non-passive listener keeps the page from
  // scrolling while zooming.
  useEffect(() => {
    const element = boardRef.current;

    if (!element) {
      return;
    }

    const handleNativeWheel = (event: globalThis.WheelEvent) => {
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

  function screenPointFromClient(clientX: number, clientY: number): Point | null {
    const bounds = boardRef.current?.getBoundingClientRect();

    return bounds ? screenPointWithin(bounds, clientX, clientY) : null;
  }

  function boardCentre(): Point {
    return { x: boardSize.width / 2, y: boardSize.height / 2 };
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (
      event.target instanceof Element &&
      (event.target.closest('[data-activity-card]') ||
        event.target.closest('[data-timeline-slot]') ||
        event.target.closest('.timeline') ||
        event.target.closest('.discard-bin'))
    ) {
      return;
    }

    const screenPoint = screenPointFromClient(event.clientX, event.clientY);
    if (!screenPoint) {
      return;
    }

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
    if (event.target instanceof Element && (event.target.closest('button') || event.target.closest('a'))) {
      return;
    }

    const boardBounds = boardRef.current?.getBoundingClientRect();
    const cardBounds = event.currentTarget.getBoundingClientRect();
    if (!boardBounds) {
      return;
    }

    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    markGesture();
    markAdjusted();
    const cardId = card.activity.id;
    if (!from) {
      const currentPos = cardPositionsById[cardId] ?? boardLayout.positionsById[cardId];
      if (currentPos && !cardPositionsById[cardId]) {
        setCardPositionsById((prev) => ({ ...prev, [cardId]: currentPos }));
      }
    }

    userCollapsedDuringDragRef.current = false;
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
      const color = PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)];
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

    const slotId = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-timeline-slot]')
      ?.dataset.timelineSlot;
    setHoveredSlotId(slotId ?? null);

    const timelineElement = typeof document !== 'undefined' ? document.querySelector<HTMLElement>('.timeline') : null;
    let nearTimeline = false;
    if (timelineElement) {
      if (document.elementFromPoint(event.clientX, event.clientY)?.closest('.timeline')) {
        nearTimeline = true;
      } else {
        const bounds = timelineElement.getBoundingClientRect();
        const proximityPadding = 50;
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
      setIsHoverExpanded(nearTimeline);
    }
  }

  function isOverDiscardBin(clientX: number, clientY: number): boolean {
    const bounds = discardBinRef.current?.getBoundingClientRect();

    return Boolean(
      bounds && clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom,
    );
  }

  function handleCardPointerUp(event: PointerEvent<HTMLElement>) {
    setIsHoverExpanded(false);
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
            setCardPositionsById((prev) => ({ ...prev, [cardId]: originalCardPos }));
          }
        }
      } else {
        if (source === 'board') {
          const originalCardPos = cardPositionsById[cardId] ?? boardLayout.positionsById[cardId];
          if (originalCardPos) {
            setCardPositionsById((prev) => ({ ...prev, [cardId]: originalCardPos }));
          }
        }

        const targetSlot = timelineSlots.find((s) => s.id === slotId);
        const replacedCardId =
          targetSlot?.activityId && targetSlot.activityId !== cardId ? targetSlot.activityId : null;

        if (replacedCardId) {
          const displacedCard = cards.find((c) => c.activity.id === replacedCardId);
          const originalReplacedPos = cardPositionsById[replacedCardId] ?? boardLayout.positionsById[replacedCardId];
          if (originalReplacedPos) {
            setCardPositionsById((prev) => ({
              ...prev,
              [replacedCardId]: originalReplacedPos,
            }));
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
            setCardPositionsById((prev) => ({ ...prev, [cardId]: originalCardPos }));
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
        setCardPositionsById((prev) => ({ ...prev, [cardId]: screenToWorld(cardScreenPoint, viewport) }));
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

  function handleCardPointerCancel(event: PointerEvent<HTMLElement>) {
    if (cardDragState?.pointerId === event.pointerId) {
      setIsHoverExpanded(false);
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
    }
  }

  async function handleFindSimilar(card: BoardActivityCard) {
    const title = card.activity.title_en ?? card.activity.title;
    const success = await findSimilar(card);
    if (success) {
      setConfirmation(findSimilarConfirmation(title));
    }
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const screenPoint = screenPointFromClient(event.clientX, event.clientY);
    if (!screenPoint) {
      return;
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
    setViewport((current) => zoomAtScreenPoint(current, boardCentre(), 1));
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
      default:
        break;
    }
  }

  const isTimelineVisible = isTimelineExpanded || isHoverExpanded;
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

  return (
    <main className="app">
      <header className="app__header">
        <div className="app__header-brand">
          <h1>{HEADING}</h1>
          <p>{TAGLINE}</p>
        </div>
        <div className="app__header-search">
          <SearchBar />
        </div>
        <div aria-label={ZOOM_CONTROL_LABEL} className="viewport-controls" role="group">
          <div className="viewport-controls__zoom">
            <button
              aria-label={ZOOM_OUT_LABEL}
              className="btn btn--sm btn--icon"
              disabled={!canZoomOut(viewport.scale)}
              onClick={() => stepZoom(-1)}
              type="button"
            >
              &minus;
            </button>
            <output aria-live="polite">{zoomPercentage(viewport.scale)}</output>
            <button
              aria-label={ZOOM_IN_LABEL}
              className="btn btn--sm btn--icon"
              disabled={!canZoomIn(viewport.scale)}
              onClick={() => stepZoom(1)}
              type="button"
            >
              +
            </button>
          </div>
          <button
            aria-label={RESET_ZOOM_LABEL}
            className="btn btn--sm"
            disabled={Math.abs(viewport.scale - 1) < 0.001}
            onClick={resetZoom}
            type="button"
          >
            100%
          </button>
          <div className="viewport-controls__autofit">
            <button className="btn btn--sm" onClick={() => fitContent(1.0)} type="button">
              {FIT_VIEW_LABEL}
            </button>
            <label className="viewport-controls__autofit-label" htmlFor="viewport-autofit-toggle">
              <input
                aria-describedby="autofit-description"
                checked={autoFitEnabled}
                className="viewport-controls__checkbox"
                id="viewport-autofit-toggle"
                onChange={(event) => setAutoFitEnabled(event.target.checked)}
                type="checkbox"
              />
              <span>{AUTO_FIT_LABEL}</span>
              <span className="viewport-controls__tooltip" id="autofit-description" role="tooltip">
                {AUTO_FIT_DESCRIPTION}
              </span>
            </label>
          </div>
        </div>
      </header>
      <AgentStatusPanel status={agentStatus} />
      <p className="sr-only" id="board-keyboard-hint">
        {BOARD_KEYBOARD_HINT}
      </p>
      <div
        aria-describedby="board-keyboard-hint"
        aria-keyshortcuts={BOARD_KEYBOARD_SHORTCUTS}
        aria-label={BOARD_LABEL}
        className={`board${dragState || pinchState ? ' board--dragging' : ''}${isGesturing ? ' board--gesturing' : ''}`}
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
          <button
            aria-expanded={false}
            aria-label={TIMELINE_EXPAND_LABEL}
            className="timeline timeline--collapsed"
            onClick={() => setIsTimelineExpanded(true)}
            type="button"
          >
            {showGuideHints ? <div className="timeline__guide-hint board__toast">{TIMELINE_GUIDE_TOAST}</div> : null}
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
          <section
            aria-label={TIMELINE_LABEL}
            className={`timeline timeline--expanded${isHoverExpanded ? ' timeline--hover-expanded' : ''}`}
          >
            {isReplacingHoveredSlot && hoveredExistingCard ? (
              <div className="timeline__guide-hint timeline__replace-toast board__toast">
                {timelineSlotReplaceAlert(hoveredExistingCard.activity.title_en ?? hoveredExistingCard.activity.title)}
              </div>
            ) : isHoverExpanded ? (
              <div className="timeline__guide-hint board__toast">{TIMELINE_DRAG_COLLAPSE_HINT}</div>
            ) : showGuideHints ? (
              <div className="timeline__guide-hint board__toast">{TIMELINE_GUIDE_TOAST}</div>
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
                  setIsHoverExpanded(false);
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
          {showGuideHints ? <div className="discard-bin__guide-hint board__toast">{DISCARD_GUIDE_TOAST}</div> : null}
          <strong>{DISCARD_BIN_LABEL}</strong>
          <span>{DISCARD_BIN_HINT}</span>
        </aside>
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
          <div
            className={`board__drag${cardDragState.source === 'timeline' ? ' board__drag--docked' : ''}`}
            style={{
              left: cardDragState.screenPoint.x - cardDragState.grabOffset.x,
              top: cardDragState.screenPoint.y - cardDragState.grabOffset.y,
            }}
          >
            <div className="board__drag-scale">
              <ActivityCard
                isRecent={recentCardIds.includes(cardDragState.card.activity.id)}
                match={cardDragState.card}
                size={cardDragState.source === 'timeline' ? 'docked' : 'canvas'}
                state="dragging"
                variant={boardLayout.variantsById[cardDragState.card.activity.id] ?? getCardVariant(cardDragState.card)}
              />
            </div>
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
                    boxShadow: `0 0 6px ${particle.color}`,
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
            <div className="board__cards">
              {agentStatus === 'searching' ? (
                <div
                  className="board__card board__card--research"
                  data-research-card
                  style={{ left: researchCardPosition.x, top: researchCardPosition.y }}
                >
                  <ResearchCard />
                </div>
              ) : null}
              {canvasCards.map(({ card: match, position, variant }) => {
                const isDragging = cardDragState?.card.activity.id === match.activity.id;
                const isDiscarding = discardingCardId === match.activity.id;

                return (
                  <div
                    className={`board__card board__card--${variant}${isDragging ? ' board__card--ghost' : ''}`}
                    data-activity-card
                    key={match.activity.id}
                    onPointerCancel={handleCardPointerCancel}
                    onPointerDown={(event) => handleCardPointerDown(event, match)}
                    onPointerMove={handleCardPointerMove}
                    onPointerUp={handleCardPointerUp}
                    style={{ left: position.x, top: position.y }}
                  >
                    <ActivityCard
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
