import { type PointerEvent, type WheelEvent, useEffect, useMemo, useRef, useState } from 'react';
import agentResponse from '../../docs/examples/agent-response.json';
import { ActivityCard } from './ActivityCard';
import type { components } from './api/schema';
import {
  BOARD_GUIDE_BODY,
  BOARD_GUIDE_TITLE,
  BOARD_LABEL,
  FIT_VIEW_LABEL,
  HEADING,
  TAGLINE,
  TIMELINE_LABEL,
  TIMELINE_SLOTS,
  ZOOM_CONTROL_LABEL,
  ZOOM_IN_LABEL,
  ZOOM_OUT_LABEL,
  zoomPercentage,
} from './copy';
import { useBoardStore } from './state/boardStore';
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
const fixtureResponse = agentResponse as components['schemas']['AgentResponse'];
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
  const activePointersRef = useRef(new Map<number, Point>());
  const timelineSlots = useBoardStore((state) => state.timelineSlots);
  const dockCard = useBoardStore((state) => state.dockCard);
  const setTimelineSlots = useBoardStore((state) => state.setTimelineSlots);
  const [viewport, setViewport] = useState<Viewport>(initialViewport);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [pinchState, setPinchState] = useState<PinchState | null>(null);
  const [cardDragState, setCardDragState] = useState<CardDragState | null>(null);
  const [dragPosition, setDragPosition] = useState<Point | null>(null);

  useEffect(() => {
    setTimelineSlots(TIMELINE_SLOTS.map((slot) => ({ ...slot, activityId: null })));
  }, [setTimelineSlots]);

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

  function handleCardPointerDown(event: PointerEvent<HTMLDivElement>, cardId: string, index: number) {
    const screenPoint = screenPointFromClient(event.clientX, event.clientY);
    if (!screenPoint) {
      return;
    }

    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setCardDragState({
      cardId,
      pointerId: event.pointerId,
      screenPoint,
      worldPoint: cardPositions[index] ?? { x: 0, y: 0 },
    });
  }

  function handleCardPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!cardDragState || cardDragState.pointerId !== event.pointerId) {
      return;
    }

    const screenPoint = screenPointFromClient(event.clientX, event.clientY);
    if (!screenPoint) {
      return;
    }

    setDragPosition({
      x: cardDragState.worldPoint.x + (screenPoint.x - cardDragState.screenPoint.x) / viewport.scale,
      y: cardDragState.worldPoint.y + (screenPoint.y - cardDragState.screenPoint.y) / viewport.scale,
    });
  }

  function finishCardDrag(event: PointerEvent<HTMLDivElement>) {
    if (!cardDragState || cardDragState.pointerId !== event.pointerId) {
      return;
    }

    const slotId = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-timeline-slot]')
      ?.dataset.timelineSlot;
    if (slotId) {
      dockCard(cardDragState.cardId, slotId);
    }

    setCardDragState(null);
    setDragPosition(null);
  }

  function cancelCardDrag() {
    setCardDragState(null);
    setDragPosition(null);
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
        <section aria-label={TIMELINE_LABEL} className="timeline">
          <h2>{TIMELINE_LABEL}</h2>
          <div className="timeline__slots">
            {timelineSlots.map((slot) => {
              const match = fixtureResponse.matches.find((candidate) => candidate.activity.id === slot.activityId);

              return (
                <div className="timeline__slot" data-timeline-slot={slot.id} key={slot.id}>
                  <span>{TIMELINE_SLOTS.find((definition) => definition.id === slot.id)?.label}</span>
                  {match ? <ActivityCard match={match} state="spawning" /> : null}
                </div>
              );
            })}
          </div>
        </section>
        <div
          className="board__world"
          style={{ transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.scale})` }}
        >
          <section className="board-guide">
            <h2>{BOARD_GUIDE_TITLE}</h2>
            <p>{BOARD_GUIDE_BODY}</p>
          </section>
          <div className="board__cards">
            {fixtureResponse.matches
              .filter((match) => !timelineSlots.some((slot) => slot.activityId === match.activity.id))
              .map((match) => {
                const index = fixtureResponse.matches.findIndex(
                  (candidate) => candidate.activity.id === match.activity.id,
                );
                const position =
                  cardDragState?.cardId === match.activity.id && dragPosition ? dragPosition : cardPositions[index];

                return (
                  <div
                    className={`board__card${cardDragState?.cardId === match.activity.id ? ' board__card--dragging' : ''}`}
                    data-activity-card
                    key={match.activity.id}
                    onPointerCancel={cancelCardDrag}
                    onPointerDown={(event) => handleCardPointerDown(event, match.activity.id, index)}
                    onPointerMove={handleCardPointerMove}
                    onPointerUp={finishCardDrag}
                    style={{ left: position?.x, top: position?.y }}
                  >
                    <ActivityCard match={match} />
                  </div>
                );
              })}
          </div>
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
