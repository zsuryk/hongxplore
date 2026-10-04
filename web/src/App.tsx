import { type PointerEvent, type WheelEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityCard } from './ActivityCard';
import { AgentStatusPanel } from './AgentStatusPanel';
import { SearchBar } from './SearchBar';
import {
  BOARD_EMPTY_STATE,
  BOARD_GUIDE_BODY,
  BOARD_GUIDE_TITLE,
  BOARD_LABEL,
  DISCARD_BIN_HINT,
  DISCARD_BIN_LABEL,
  FIT_VIEW_LABEL,
  HEADING,
  INITIAL_ACTIVITY_QUERY,
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
import { type ActivityCard as BoardActivityCard, useBoardStore } from './state/boardStore';
import {
  fitViewport,
  initialViewport,
  panViewport,
  pinchViewport,
  type Point,
  screenToWorld,
  type Viewport,
  zoomAtScreenPoint,
} from './viewport';

const GRID_SIZE = 40;
const FIT_PADDING = 96;
const ZOOM_STEP = 1.2;
const CONTENT_BOUNDS = { x: -560, y: -300, width: 1120, height: 600 };

function getDefaultCardPosition(index: number): Point {
  const col = index % 3;
  const row = Math.floor(index / 3);

  return {
    x: -520 + col * 360,
    y: 80 + row * 400,
  };
}

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

  const cards = useBoardStore((state) => state.cards);
  const timelineSlots = useBoardStore((state) => state.timelineSlots);
  const discardCard = useBoardStore((state) => state.discardCard);
  const dockCard = useBoardStore((state) => state.dockCard);
  const undockCard = useBoardStore((state) => state.undockCard);
  const findSimilar = useBoardStore((state) => state.findSimilar);
  const loadAgentResponse = useBoardStore((state) => state.loadAgentResponse);
  const setTimelineSlots = useBoardStore((state) => state.setTimelineSlots);

  const [viewport, setViewport] = useState<Viewport>(initialViewport);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [pinchState, setPinchState] = useState<PinchState | null>(null);
  const [cardDragState, setCardDragState] = useState<CardDragState | null>(null);
  const [hoveredSlotId, setHoveredSlotId] = useState<string | null>(null);
  const [cardPositionsById, setCardPositionsById] = useState<Record<string, Point>>({});
  const [discardingCardId, setDiscardingCardId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  const fitContent = useCallback(() => {
    const bounds = boardRef.current?.getBoundingClientRect();
    if (!bounds) {
      return;
    }

    setViewport(fitViewport(CONTENT_BOUNDS, { x: 0, y: 0, width: bounds.width, height: bounds.height }, FIT_PADDING));
  }, []);

  useEffect(() => {
    setTimelineSlots(TIMELINE_SLOTS.map((slot) => ({ ...slot, activityId: null })));
    void loadAgentResponse({ query: INITIAL_ACTIVITY_QUERY });

    const rafId = requestAnimationFrame(() => {
      fitContent();
    });

    window.addEventListener('resize', fitContent);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', fitContent);
    };
  }, [fitContent, loadAgentResponse, setTimelineSlots]);

  const gridStyle = useMemo(() => {
    const gridSize = GRID_SIZE * viewport.scale;

    return {
      backgroundPosition: `${viewport.x % gridSize}px ${viewport.y % gridSize}px`,
      backgroundSize: `${gridSize}px ${gridSize}px`,
    };
  }, [viewport.scale, viewport.x, viewport.y]);

  function screenPointFromClient(clientX: number, clientY: number): Point | null {
    const bounds = boardRef.current?.getBoundingClientRect();
    if (!bounds) {
      return null;
    }

    return { x: clientX - bounds.left, y: clientY - bounds.top };
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
    }
  }

  function handleBoardCardPointerDown(event: PointerEvent<HTMLElement>, card: BoardActivityCard) {
    if (event.target instanceof Element && (event.target.closest('button') || event.target.closest('a'))) {
      return;
    }

    const boardBounds = boardRef.current?.getBoundingClientRect();
    const cardBounds = event.currentTarget.getBoundingClientRect();
    if (!boardBounds) {
      return;
    }

    const screenPoint = {
      x: event.clientX - boardBounds.left,
      y: event.clientY - boardBounds.top,
    };
    const grabOffset = {
      x: event.clientX - cardBounds.left,
      y: event.clientY - cardBounds.top,
    };

    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);

    setCardDragState({
      card,
      source: 'board',
      pointerId: event.pointerId,
      screenPoint,
      grabOffset,
    });
  }

  function handleTimelineCardPointerDown(event: PointerEvent<HTMLElement>, card: BoardActivityCard, slotId: string) {
    if (event.target instanceof Element && (event.target.closest('button') || event.target.closest('a'))) {
      return;
    }

    const boardBounds = boardRef.current?.getBoundingClientRect();
    const cardBounds = event.currentTarget.getBoundingClientRect();
    if (!boardBounds) {
      return;
    }

    const screenPoint = {
      x: event.clientX - boardBounds.left,
      y: event.clientY - boardBounds.top,
    };
    const grabOffset = {
      x: event.clientX - cardBounds.left,
      y: event.clientY - cardBounds.top,
    };

    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);

    setCardDragState({
      card,
      source: 'timeline',
      fromSlotId: slotId,
      pointerId: event.pointerId,
      screenPoint,
      grabOffset,
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

    const screenPoint = {
      x: event.clientX - boardBounds.left,
      y: event.clientY - boardBounds.top,
    };

    setCardDragState((prev) => (prev ? { ...prev, screenPoint } : null));

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
      }, 220);
    } else {
      if (source === 'timeline' && fromSlotId) {
        undockCard(fromSlotId);
      }
      const cardScreenPoint = {
        x: screenPoint.x - grabOffset.x,
        y: screenPoint.y - grabOffset.y,
      };
      const worldPos = screenToWorld(cardScreenPoint, viewport);
      setCardPositionsById((prev) => ({
        ...prev,
        [cardId]: worldPos,
      }));
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

  function cardPosition(card: BoardActivityCard, index: number): Point {
    return cardPositionsById[card.activity.id] ?? getDefaultCardPosition(index);
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
      const midpoint = midpointBetween(firstPointer, secondPointer);
      setViewport(
        pinchViewport(
          pinchState.viewport,
          pinchState.screenPoint,
          midpoint,
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

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    const screenPoint = screenPointFromClient(event.clientX, event.clientY);
    if (!screenPoint) {
      return;
    }

    event.preventDefault();
    const zoomFactor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    setViewport((currentViewport) =>
      zoomAtScreenPoint(currentViewport, screenPoint, currentViewport.scale * zoomFactor),
    );
  }

  function zoomFromCenter(factor: number) {
    const bounds = boardRef.current?.getBoundingClientRect();
    if (!bounds) {
      return;
    }

    const center = { x: bounds.width / 2, y: bounds.height / 2 };
    setViewport((currentViewport) => zoomAtScreenPoint(currentViewport, center, currentViewport.scale * factor));
  }

  const availableCards = cards.filter((match) => !timelineSlots.some((slot) => slot.activityId === match.activity.id));

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
        <div aria-label={ZOOM_CONTROL_LABEL} className="viewport-controls">
          <button aria-label={ZOOM_OUT_LABEL} onClick={() => zoomFromCenter(1 / ZOOM_STEP)} type="button">
            −
          </button>
          <output>{zoomPercentage(viewport.scale)}</output>
          <button aria-label={ZOOM_IN_LABEL} onClick={() => zoomFromCenter(ZOOM_STEP)} type="button">
            +
          </button>
          <button onClick={fitContent} type="button">
            {FIT_VIEW_LABEL}
          </button>
        </div>
      </header>
      <AgentStatusPanel />
      <div
        aria-label={BOARD_LABEL}
        className={`board${dragState || pinchState ? ' board--dragging' : ''}`}
        onPointerCancel={stopDragging}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onWheel={handleWheel}
        ref={boardRef}
        role="application"
        style={gridStyle}
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
                        className="timeline__slot-remove"
                        onClick={() => undockCard(slot.id)}
                        type="button"
                      >
                        ✕
                      </button>
                    ) : null}
                  </div>
                  {match ? (
                    <div
                      className={`timeline__docked-card${isDraggingThisCard ? ' timeline__docked-card--ghost' : ''}`}
                      onPointerCancel={handleCardPointerCancel}
                      onPointerDown={(event) => handleTimelineCardPointerDown(event, match, slot.id)}
                      onPointerMove={handleCardPointerMove}
                      onPointerUp={handleCardPointerUp}
                    >
                      <ActivityCard match={match} state="spawning" />
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
        {cardDragState ? (
          <div
            className="board__drag-overlay"
            style={{
              left: cardDragState.screenPoint.x - cardDragState.grabOffset.x,
              top: cardDragState.screenPoint.y - cardDragState.grabOffset.y,
            }}
          >
            <ActivityCard match={cardDragState.card} state="spawning" />
          </div>
        ) : null}
        <div
          className="board__world"
          style={{ transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.scale})` }}
        >
          <section className="board-guide">
            <h2>{BOARD_GUIDE_TITLE}</h2>
            <p>{BOARD_GUIDE_BODY}</p>
          </section>
          <div className="board__cards">
            {availableCards.map((match, index) => {
              const isDragging = cardDragState?.card.activity.id === match.activity.id;
              const position = cardPosition(match, index);
              const isDiscarding = discardingCardId === match.activity.id;

              return (
                <div
                  className={`board__card${isDragging ? ' board__card--ghost' : ''}`}
                  data-activity-card
                  key={match.activity.id}
                  onPointerCancel={handleCardPointerCancel}
                  onPointerDown={(event) => handleBoardCardPointerDown(event, match)}
                  onPointerMove={handleCardPointerMove}
                  onPointerUp={handleCardPointerUp}
                  style={{ left: position.x, top: position.y }}
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
          {cards.length === 0 ? <p className="board__empty-state">{BOARD_EMPTY_STATE}</p> : null}
          {confirmation ? <p className="board__confirmation">{confirmation}</p> : null}
        </div>
      </div>
    </main>
  );
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
