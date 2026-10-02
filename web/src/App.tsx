import { type PointerEvent, type WheelEvent, useMemo, useRef, useState } from 'react';
import {
  BOARD_GUIDE_BODY,
  BOARD_GUIDE_TITLE,
  BOARD_LABEL,
  FIT_VIEW_LABEL,
  HEADING,
  TAGLINE,
  ZOOM_CONTROL_LABEL,
  ZOOM_IN_LABEL,
  ZOOM_OUT_LABEL,
  zoomPercentage,
} from './copy';
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
const CONTENT_BOUNDS = { x: -280, y: -160, width: 560, height: 320 };

type DragState = {
  pointerId: number;
  screenPoint: Point;
};

type PinchState = {
  distance: number;
  screenPoint: Point;
  viewport: Viewport;
};

export function App() {
  const boardRef = useRef<HTMLDivElement>(null);
  const activePointersRef = useRef(new Map<number, Point>());
  const [viewport, setViewport] = useState<Viewport>(initialViewport);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [pinchState, setPinchState] = useState<PinchState | null>(null);

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
        <div
          className="board__world"
          style={{ transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.scale})` }}
        >
          <section className="board-guide" style={CONTENT_BOUNDS}>
            <h2>{BOARD_GUIDE_TITLE}</h2>
            <p>{BOARD_GUIDE_BODY}</p>
          </section>
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
