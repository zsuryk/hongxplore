import { type PointerEvent, type WheelEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityCard } from './ActivityCard';
import {
  BOARD_GUIDE_BODY,
  BOARD_GUIDE_TITLE,
  BOARD_LABEL,
  BOARD_EMPTY_STATE,
  DISCARD_BIN_HINT,
  DISCARD_BIN_LABEL,
  FIT_VIEW_LABEL,
  HEADING,
  INITIAL_ACTIVITY_QUERY,
  TAGLINE,
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
  type Viewport,
  zoomAtScreenPoint,
} from './viewport';

const GRID_SIZE = 40;
const FIT_PADDING = 96;
const ZOOM_STEP = 1.2;
const CONTENT_BOUNDS = { x: -560, y: -300, width: 1120, height: 600 };
const cardPositions = [
  { x: -520, y: 80 },
  { x: -160, y: 80 },
  { x: 200, y: 80 },
];

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
  cardId: string;
  pointerId: number;
  screenPoint: Point;
  worldPoint: Point;
};

export function App() {
  const boardRef = useRef<HTMLDivElement>(null);
  const discardBinRef = useRef<HTMLElement>(null);
  const activePointersRef = useRef(new Map<number, Point>());
  const cards = useBoardStore((state) => state.cards);
  const discardCard = useBoardStore((state) => state.discardCard);
  const findSimilar = useBoardStore((state) => state.findSimilar);
  const loadAgentResponse = useBoardStore((state) => state.loadAgentResponse);
  const [viewport, setViewport] = useState<Viewport>(initialViewport);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [pinchState, setPinchState] = useState<PinchState | null>(null);
  const [cardDragState, setCardDragState] = useState<CardDragState | null>(null);
  const [cardPositionsById, setCardPositionsById] = useState<Record<string, Point>>({});
  const [discardingCardId, setDiscardingCardId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  useEffect(() => {
    void loadAgentResponse({ query: INITIAL_ACTIVITY_QUERY });
  }, [loadAgentResponse]);

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
    if (event.target instanceof Element && event.target.closest('[data-activity-card]')) {
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

  function handleCardPointerDown(event: PointerEvent<HTMLElement>, card: BoardActivityCard, index: number) {
    const screenPoint = screenPointFromClient(event.clientX, event.clientY);
    if (!screenPoint) {
      return;
    }

    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setCardDragState({
      cardId: card.activity.id,
      pointerId: event.pointerId,
      screenPoint,
      worldPoint: cardPosition(card, index),
    });
  }

  function handleCardPointerMove(event: PointerEvent<HTMLElement>) {
    if (!cardDragState || cardDragState.pointerId !== event.pointerId) {
      return;
    }

    const screenPoint = screenPointFromClient(event.clientX, event.clientY);
    if (!screenPoint) {
      return;
    }

    setCardPositionsById((positions) => ({
      ...positions,
      [cardDragState.cardId]: {
        x: cardDragState.worldPoint.x + (screenPoint.x - cardDragState.screenPoint.x) / viewport.scale,
        y: cardDragState.worldPoint.y + (screenPoint.y - cardDragState.screenPoint.y) / viewport.scale,
      },
    }));
  }

  function handleCardPointerUp(event: PointerEvent<HTMLElement>) {
    if (!cardDragState || cardDragState.pointerId !== event.pointerId) {
      return;
    }

    const discardedCardId = cardDragState.cardId;
    setCardDragState(null);

    if (isOverDiscardBin(event.clientX, event.clientY)) {
      setDiscardingCardId(discardedCardId);
      window.setTimeout(() => {
        discardCard(discardedCardId);
        setDiscardingCardId(null);
      }, 220);
    }
  }

  function handleCardPointerCancel(event: PointerEvent<HTMLElement>) {
    if (cardDragState?.pointerId === event.pointerId) {
      setCardDragState(null);
    }
  }

  async function handleFindSimilar(card: BoardActivityCard) {
    const title = card.activity.title_en ?? card.activity.title;
    await findSimilar(card);
    setConfirmation(findSimilarConfirmation(title));
  }

  function cardPosition(card: BoardActivityCard, index: number): Point {
    return cardPositionsById[card.activity.id] ?? cardPositions[index] ?? { x: 0, y: 80 };
  }

  function isOverDiscardBin(clientX: number, clientY: number): boolean {
    const bounds = discardBinRef.current?.getBoundingClientRect();

    return Boolean(
      bounds && clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom,
    );
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

  function fitContent() {
    const bounds = boardRef.current?.getBoundingClientRect();
    if (!bounds) {
      return;
    }

    setViewport(fitViewport(CONTENT_BOUNDS, { x: 0, y: 0, width: bounds.width, height: bounds.height }, FIT_PADDING));
  }

  function zoomFromCenter(factor: number) {
    const bounds = boardRef.current?.getBoundingClientRect();
    if (!bounds) {
      return;
    }

    const center = { x: bounds.width / 2, y: bounds.height / 2 };
    setViewport((currentViewport) => zoomAtScreenPoint(currentViewport, center, currentViewport.scale * factor));
  }

  return (
    <main className="app">
      <header className="app__header">
        <div>
          <h1>{HEADING}</h1>
          <p>{TAGLINE}</p>
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
        <aside
          aria-label={DISCARD_BIN_LABEL}
          className={`discard-bin${cardDragState ? ' discard-bin--active' : ''}`}
          ref={discardBinRef}
        >
          <strong>{DISCARD_BIN_LABEL}</strong>
          <span>{DISCARD_BIN_HINT}</span>
        </aside>
        <div
          className="board__world"
          style={{ transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.scale})` }}
        >
          <section className="board-guide">
            <h2>{BOARD_GUIDE_TITLE}</h2>
            <p>{BOARD_GUIDE_BODY}</p>
          </section>
          <div className="board__cards">
            {cards.map((match, index) => {
              const position = cardPosition(match, index);
              const isDiscarding = discardingCardId === match.activity.id;

              return (
                <div
                  className={`board__card${cardDragState?.cardId === match.activity.id ? ' board__card--dragging' : ''}`}
                  data-activity-card
                  key={match.activity.id}
                  onPointerCancel={handleCardPointerCancel}
                  onPointerDown={(event) => handleCardPointerDown(event, match, index)}
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
