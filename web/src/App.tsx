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
import { SearchBar } from './SearchBar';
import {
  BOARD_EMPTY_STATE,
  BOARD_GUIDE_BODY,
  BOARD_GUIDE_TITLE,
  BOARD_KEYBOARD_HINT,
  BOARD_KEYBOARD_SHORTCUTS,
  BOARD_LABEL,
  DISCARD_BIN_HINT,
  DISCARD_BIN_LABEL,
  FIT_VIEW_LABEL,
  HEADING,
  INITIAL_ACTIVITY_QUERY,
  RESET_ZOOM_LABEL,
  TAGLINE,
  TIMELINE_LABEL,
  TIMELINE_SLOT_EMPTY,
  TIMELINE_SLOTS,
  UNDOCK_CARD_LABEL,
  ZOOM_CONTROL_LABEL,
  ZOOM_IN_LABEL,
  ZOOM_OUT_LABEL,
  findSimilarConfirmation,
  zoomPercentage,
} from './copy';
import {
  BOARD_FIT_PADDING,
  BOARD_GRID_SIZE,
  CARD_DISCARD_DURATION_MS,
  CARD_MIN_HEIGHT,
  CARD_WIDTH,
  contentBounds,
  defaultCardPosition,
} from './boardLayout';
import { type ActivityCard as BoardActivityCard, useBoardStore } from './state/boardStore';
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
  source: 'board' | 'timeline';
  fromSlotId?: string;
  pointerId: number;
  screenPoint: Point;
  grabOffset: Point;
};

export function App() {
  const boardRef = useRef<HTMLDivElement>(null);
  const discardBinRef = useRef<HTMLElement>(null);
  const activePointersRef = useRef(new Map<number, Point>());
  const contentBoundsRef = useRef<Rect>(contentBounds([]));
  const hasAdjustedRef = useRef(false);
  const previousSizeRef = useRef<Size>({ width: 0, height: 0 });
  const gestureTimerRef = useRef<number | null>(null);

  const cards = useBoardStore((state) => state.cards);
  const timelineSlots = useBoardStore((state) => state.timelineSlots);
  const discardCard = useBoardStore((state) => state.discardCard);
  const dockCard = useBoardStore((state) => state.dockCard);
  const undockCard = useBoardStore((state) => state.undockCard);
  const findSimilar = useBoardStore((state) => state.findSimilar);
  const loadAgentResponse = useBoardStore((state) => state.loadAgentResponse);
  const setTimelineSlots = useBoardStore((state) => state.setTimelineSlots);

  const [viewport, setViewport] = useState<Viewport>(initialViewport);
  const [boardSize, setBoardSize] = useState<Size>({ width: 0, height: 0 });
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [pinchState, setPinchState] = useState<PinchState | null>(null);
  const [cardDragState, setCardDragState] = useState<CardDragState | null>(null);
  const [isGesturing, setIsGesturing] = useState(false);
  const [hoveredSlotId, setHoveredSlotId] = useState<string | null>(null);
  const [cardPositionsById, setCardPositionsById] = useState<Record<string, Point>>({});
  const [discardingCardId, setDiscardingCardId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  const availableCards = useMemo(
    () => cards.filter((match) => !timelineSlots.some((slot) => slot.activityId === match.activity.id)),
    [cards, timelineSlots],
  );

  const placedCards = useMemo(
    () =>
      availableCards.map((match, index) => ({
        position: cardPositionsById[match.activity.id] ?? defaultCardPosition(index),
      })),
    [availableCards, cardPositionsById],
  );

  useEffect(() => {
    setTimelineSlots(TIMELINE_SLOTS.map((slot) => ({ ...slot, activityId: null })));
    void loadAgentResponse({ query: INITIAL_ACTIVITY_QUERY });
  }, [loadAgentResponse, setTimelineSlots]);

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

  const fitContent = useCallback(() => {
    const { width, height } = previousSizeRef.current;

    if (width <= 0 || height <= 0) {
      return;
    }

    setViewport(fitViewport(contentBoundsRef.current, { x: 0, y: 0, width, height }, BOARD_FIT_PADDING));
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

  useEffect(() => {
    if (boardSize.width <= 0 || boardSize.height <= 0) {
      return;
    }

    const previousSize = previousSizeRef.current;
    previousSizeRef.current = boardSize;

    // Before the user takes over, keep re-framing the board as it grows.
    if (!hasAdjustedRef.current) {
      fitContent();
      return;
    }

    // Afterwards a resize must not throw their pan and zoom away: hold the centre point.
    if (previousSize.width > 0 && previousSize.height > 0) {
      setViewport((current) => preserveViewportCenter(current, previousSize, boardSize));
    }
  }, [boardSize, fitContent]);

  useEffect(() => {
    contentBoundsRef.current = contentBounds(placedCards);

    // Cards arrive asynchronously, so framing the board once on layout would frame an
    // empty board. Keep framing until the user takes over, then never move it again.
    if (!hasAdjustedRef.current) {
      fitContent();
    }
  }, [fitContent, placedCards]);

  const markGesture = useCallback(() => {
    setIsGesturing(true);

    if (gestureTimerRef.current !== null) {
      window.clearTimeout(gestureTimerRef.current);
    }

    gestureTimerRef.current = window.setTimeout(() => {
      gestureTimerRef.current = null;
      setIsGesturing(false);
    }, GESTURE_SETTLE_MS);
  }, []);

  useEffect(
    () => () => {
      if (gestureTimerRef.current !== null) {
        window.clearTimeout(gestureTimerRef.current);
      }
    },
    [],
  );

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

    setCardDragState({
      card,
      source: from ? 'timeline' : 'board',
      fromSlotId: from?.slotId,
      pointerId: event.pointerId,
      screenPoint: screenPointWithin(boardBounds, event.clientX, event.clientY),
      grabOffset: {
        x: event.clientX - cardBounds.left,
        y: event.clientY - cardBounds.top,
      },
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

    setCardDragState((prev) =>
      prev ? { ...prev, screenPoint: screenPointWithin(boardBounds, event.clientX, event.clientY) } : null,
    );

    const slotId = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-timeline-slot]')
      ?.dataset.timelineSlot;
    setHoveredSlotId(slotId ?? null);
  }

  function isOverDiscardBin(clientX: number, clientY: number): boolean {
    const bounds = discardBinRef.current?.getBoundingClientRect();

    return Boolean(
      bounds && clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom,
    );
  }

  function handleCardPointerUp(event: PointerEvent<HTMLElement>) {
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
      dockCard(cardId, slotId);
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
      if (source === 'timeline' && fromSlotId) {
        undockCard(fromSlotId);
      }
      const cardScreenPoint = {
        x: screenPoint.x - grabOffset.x,
        y: screenPoint.y - grabOffset.y,
      };
      setCardPositionsById((prev) => ({ ...prev, [cardId]: screenToWorld(cardScreenPoint, viewport) }));
    }

    setCardDragState(null);
    setHoveredSlotId(null);
  }

  function handleCardPointerCancel(event: PointerEvent<HTMLElement>) {
    if (cardDragState?.pointerId === event.pointerId) {
      setCardDragState(null);
      setHoveredSlotId(null);
    }
  }

  async function handleFindSimilar(card: BoardActivityCard) {
    const title = card.activity.title_en ?? card.activity.title;
    await findSimilar(card);
    setConfirmation(findSimilarConfirmation(title));
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
          <button className="btn btn--sm" onClick={fitContent} type="button">
            {FIT_VIEW_LABEL}
          </button>
        </div>
      </header>
      <AgentStatusPanel />
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
        <section aria-label={TIMELINE_LABEL} className="timeline">
          <h2>{TIMELINE_LABEL}</h2>
          <div className="timeline__slots">
            {timelineSlots.map((slot) => {
              const match = cards.find((candidate) => candidate.activity.id === slot.activityId);
              const isDraggingThisCard = cardDragState?.card.activity.id === match?.activity.id;

              return (
                <div
                  className={`timeline__slot${hoveredSlotId === slot.id ? ' timeline__slot--dragover' : ''}`}
                  data-timeline-slot={slot.id}
                  key={slot.id}
                >
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
        <aside
          aria-label={DISCARD_BIN_LABEL}
          className={`discard-bin${cardDragState ? ' discard-bin--active' : ''}`}
          ref={discardBinRef}
        >
          <strong>{DISCARD_BIN_LABEL}</strong>
          <span>{DISCARD_BIN_HINT}</span>
        </aside>
        {cards.length === 0 ? (
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
            <p className="board__toast">{confirmation}</p>
          </div>
        ) : null}
        {cardDragState ? (
          <div
            className="board__drag"
            style={{
              left: cardDragState.screenPoint.x - cardDragState.grabOffset.x,
              top: cardDragState.screenPoint.y - cardDragState.grabOffset.y,
            }}
          >
            <div className="board__drag-scale">
              <ActivityCard match={cardDragState.card} size="canvas" state="spawning" />
            </div>
          </div>
        ) : null}
        <div className="board__pan">
          <div className="board__world">
            <div className="board__cards">
              {availableCards.map((match, index) => {
                const isDragging = cardDragState?.card.activity.id === match.activity.id;
                const isDiscarding = discardingCardId === match.activity.id;

                return (
                  <div
                    className={`board__card${isDragging ? ' board__card--ghost' : ''}`}
                    data-activity-card
                    key={match.activity.id}
                    onPointerCancel={handleCardPointerCancel}
                    onPointerDown={(event) => handleCardPointerDown(event, match)}
                    onPointerMove={handleCardPointerMove}
                    onPointerUp={handleCardPointerUp}
                    style={{ left: placedCards[index].position.x, top: placedCards[index].position.y }}
                  >
                    <ActivityCard
                      match={match}
                      onFindSimilar={handleFindSimilar}
                      state={isDiscarding ? 'discarding' : 'spawning'}
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
