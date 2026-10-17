import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { DeckCard } from './DeckCard';
import type { components } from './api/schema';
import { getActivityMatchingSlotId } from './boardLayout';
import {
  DECK_DISCARD_LABEL,
  DECK_DISCARD_TOOLTIP,
  DECK_DOCK_LABEL,
  DECK_DOCK_TOOLTIP,
  DECK_EMPTY_BODY,
  DECK_EMPTY_RESTORE_CTA,
  DECK_EMPTY_SEARCH_CTA,
  DECK_EMPTY_TITLE,
  DECK_EMPTY_VIEW_PLAN_CTA,
  DECK_KEYBOARD_HINT,
  DECK_SKIP_LABEL,
  DECK_SKIP_TOOLTIP,
  DECK_SLOT_PICKER_HINT,
  DECK_SLOT_PICKER_TITLE,
  DECK_UNDO_LABEL,
  DECK_UNDO_TOOLTIP,
  TIMELINE_SLOTS,
  deckCardsRemaining,
  deckStackCount,
} from './copy';
import { IconCheck, IconClose, IconSkip, IconUndo } from './icons';
import { useBoardStore } from './state/boardStore';

type MatchedActivity = components['schemas']['MatchedActivity'];

export type DeckViewProps = {
  cards?: MatchedActivity[];
  timelineSlots?: components['schemas']['MatchedActivity'] extends never
    ? never
    : { id: string; activityId: string | null }[];
  onFindSimilar?: (match: MatchedActivity) => void;
  onSearchFocus?: () => void;
  onSwitchToBoard?: () => void;
};

const SWIPE_THRESHOLD_PX = 80;

export function DeckView({
  cards: propCards,
  timelineSlots: propTimelineSlots,
  onFindSimilar,
  onSearchFocus,
  onSwitchToBoard,
}: DeckViewProps) {
  const storeCards = useBoardStore((state) => state.cards);
  const cards = propCards ?? storeCards;
  const storeTimelineSlots = useBoardStore((state) => state.timelineSlots);
  const timelineSlots = propTimelineSlots ?? storeTimelineSlots;
  const undoStack = useBoardStore((state) => state.undoStack);
  const discardCard = useBoardStore((state) => state.discardCard);
  const dockCard = useBoardStore((state) => state.dockCard);
  const undoLastAction = useBoardStore((state) => state.undoLastAction);
  const restoreDiscardedCards = useBoardStore((state) => state.restoreDiscardedCards);
  const setViewMode = useBoardStore((state) => state.setViewMode);

  const [cardIndex, setCardIndex] = useState(0);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [isSlotPickerOpen, setIsSlotPickerOpen] = useState(false);

  const dragStartRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);

  // Compute unassigned cards (neither docked nor discarded)
  const dockedActivityIds = useMemo(
    () => new Set(timelineSlots.map((s) => s.activityId).filter((id): id is string => Boolean(id))),
    [timelineSlots],
  );

  const unassignedCards = useMemo(
    () => cards.filter((c) => !dockedActivityIds.has(c.activity.id)),
    [cards, dockedActivityIds],
  );

  // Clamp current card safely within unassignedCards
  const activeCardIndex = unassignedCards.length > 0 ? cardIndex % unassignedCards.length : 0;
  const activeCard = unassignedCards[activeCardIndex] ?? null;
  const ghostCard1 =
    unassignedCards.length > 1 ? unassignedCards[(activeCardIndex + 1) % unassignedCards.length] : null;
  const ghostCard2 =
    unassignedCards.length > 2 ? unassignedCards[(activeCardIndex + 2) % unassignedCards.length] : null;

  const canUndo = undoStack.length > 0;

  // Actions
  const handleDiscard = useCallback(() => {
    if (!activeCard) return;
    setDragOffset(null);
    setIsSlotPickerOpen(false);
    discardCard(activeCard.activity.id);
  }, [activeCard, discardCard]);

  const handleSkip = useCallback(() => {
    if (unassignedCards.length <= 1) return;
    setDragOffset(null);
    setIsSlotPickerOpen(false);
    setCardIndex((prev) => prev + 1);
  }, [unassignedCards.length]);

  const handleDockSlot = useCallback(
    (slotId: string) => {
      if (!activeCard) return;
      setDragOffset(null);
      setIsSlotPickerOpen(false);
      dockCard(activeCard.activity.id, slotId, { replace: true });
    },
    [activeCard, dockCard],
  );

  const handleQuickDock = useCallback(() => {
    if (!activeCard) return;
    const startIso = activeCard.activity.parts[0]?.start;
    const matchedSlotId = getActivityMatchingSlotId(startIso);

    if (matchedSlotId) {
      const destination = timelineSlots.find((s) => s.id === matchedSlotId);
      if (destination && !destination.activityId) {
        // Slot is empty -> instant dock!
        handleDockSlot(matchedSlotId);
        return;
      }
    }

    // Otherwise show slot picker so user selects slot
    setIsSlotPickerOpen(true);
  }, [activeCard, handleDockSlot, timelineSlots]);

  const handleUndo = useCallback(() => {
    setDragOffset(null);
    setIsSlotPickerOpen(false);
    undoLastAction();
  }, [undoLastAction]);

  // Pointer swipe gestures
  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('button') || target.closest('a')) return;

    dragStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragOffset({ x: 0, y: 0 });
  };

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!dragStartRef.current || dragStartRef.current.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - dragStartRef.current.x;
    const deltaY = event.clientY - dragStartRef.current.y;
    setDragOffset({ x: deltaX, y: deltaY });
  };

  const handlePointerUp = (event: PointerEvent<HTMLElement>) => {
    if (!dragStartRef.current || dragStartRef.current.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - dragStartRef.current.x;
    dragStartRef.current = null;

    if (deltaX < -SWIPE_THRESHOLD_PX) {
      handleDiscard();
    } else if (deltaX > SWIPE_THRESHOLD_PX) {
      handleQuickDock();
    } else {
      setDragOffset(null);
    }
  };

  const handlePointerCancel = () => {
    dragStartRef.current = null;
    setDragOffset(null);
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) {
        return;
      }

      if (event.key === 'ArrowLeft' || event.key === 'Backspace') {
        event.preventDefault();
        handleDiscard();
      } else if (event.key === 'ArrowRight' || event.key === 'Enter') {
        event.preventDefault();
        handleQuickDock();
      } else if (event.key === ' ') {
        event.preventDefault();
        handleSkip();
      } else if ((event.key === 'z' || event.key === 'Z') && (event.metaKey || event.ctrlKey || !event.shiftKey)) {
        event.preventDefault();
        handleUndo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleDiscard, handleQuickDock, handleSkip, handleUndo]);

  const swipeDirection = dragOffset ? (dragOffset.x < -30 ? 'left' : dragOffset.x > 30 ? 'right' : null) : null;

  const cardStyle: CSSProperties | undefined = dragOffset
    ? {
        transform: `translate(${dragOffset.x}px, ${dragOffset.y * 0.4}px) rotate(${dragOffset.x * 0.05}deg)`,
        transition: 'none',
      }
    : undefined;

  // Render Empty State if no unassigned cards remain
  if (!activeCard) {
    return (
      <main className="deck-view">
        <div className="deck-view__inner">
          <section className="deck-empty">
            <h2 className="deck-empty__title">{DECK_EMPTY_TITLE}</h2>
            <p className="deck-empty__body">{DECK_EMPTY_BODY}</p>

            <div className="deck-empty__actions">
              <button
                className="btn btn--primary"
                onClick={() => {
                  onSwitchToBoard?.();
                  setViewMode('board');
                }}
                type="button"
              >
                {DECK_EMPTY_VIEW_PLAN_CTA}
              </button>

              <button className="btn btn--subtle" onClick={() => restoreDiscardedCards()} type="button">
                {DECK_EMPTY_RESTORE_CTA}
              </button>

              {onSearchFocus ? (
                <button className="btn btn--subtle" onClick={onSearchFocus} type="button">
                  {DECK_EMPTY_SEARCH_CTA}
                </button>
              ) : null}
            </div>
          </section>
        </div>
      </main>
    );
  }

  const serialIndex = cards.findIndex((candidate) => candidate.activity.id === activeCard.activity.id);

  return (
    <main className="deck-view">
      <div className="deck-view__inner">
        {/* Status Bar */}
        <div className="deck-view__status-bar">
          <span>{deckStackCount(activeCardIndex + 1, unassignedCards.length)}</span>
          <span>{deckCardsRemaining(unassignedCards.length)}</span>
        </div>

        {/* Card Stack */}
        <div className="deck-stack">
          {ghostCard2 ? (
            <div className="deck-stack__item deck-stack__item--ghost-2">
              <DeckCard isGhost match={ghostCard2} />
            </div>
          ) : null}

          {ghostCard1 ? (
            <div className="deck-stack__item deck-stack__item--ghost-1">
              <DeckCard isGhost match={ghostCard1} />
            </div>
          ) : null}

          <div
            className="deck-stack__item deck-stack__item--active"
            onLostPointerCapture={handlePointerCancel}
            onPointerCancel={handlePointerCancel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <DeckCard
              index={serialIndex >= 0 ? serialIndex : activeCardIndex}
              match={activeCard}
              onFindSimilar={onFindSimilar}
              style={cardStyle}
              swipeDirection={swipeDirection}
            />
          </div>
        </div>

        {/* Inline Slot Picker when triggered */}
        {isSlotPickerOpen ? (
          <aside aria-label={DECK_SLOT_PICKER_TITLE} className="deck-slot-picker">
            <h3 className="deck-slot-picker__title">{DECK_SLOT_PICKER_TITLE}</h3>
            <p className="deck-controls__hint">{DECK_SLOT_PICKER_HINT}</p>
            <div className="deck-slot-picker__chips">
              {TIMELINE_SLOTS.map((slot) => {
                const isOccupied = timelineSlots.some((s) => s.id === slot.id && s.activityId !== null);
                return (
                  <button
                    className="deck-slot-picker__chip"
                    key={slot.id}
                    onClick={() => handleDockSlot(slot.id)}
                    type="button"
                  >
                    {slot.label} {isOccupied ? '(*)' : ''}
                  </button>
                );
              })}
            </div>
          </aside>
        ) : null}

        {/* Action Controls Bar */}
        <div className="deck-controls" role="toolbar">
          <button
            aria-label={DECK_DISCARD_LABEL}
            className="deck-controls__btn deck-controls__btn--discard"
            onClick={handleDiscard}
            title={DECK_DISCARD_TOOLTIP}
            type="button"
          >
            <IconClose />
          </button>

          <button
            aria-label={DECK_UNDO_LABEL}
            className="deck-controls__btn"
            disabled={!canUndo}
            onClick={handleUndo}
            title={DECK_UNDO_TOOLTIP}
            type="button"
          >
            <IconUndo />
          </button>

          <button
            aria-label={DECK_SKIP_LABEL}
            className="deck-controls__btn"
            disabled={unassignedCards.length <= 1}
            onClick={handleSkip}
            title={DECK_SKIP_TOOLTIP}
            type="button"
          >
            <IconSkip />
          </button>

          <button
            aria-label={DECK_DOCK_LABEL}
            className="deck-controls__btn deck-controls__btn--dock"
            onClick={handleQuickDock}
            title={DECK_DOCK_TOOLTIP}
            type="button"
          >
            <IconCheck />
          </button>
        </div>

        <p className="deck-controls__hint">{DECK_KEYBOARD_HINT}</p>
      </div>
    </main>
  );
}
