import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { DeckCard } from './DeckCard';
import type { components } from './api/schema';
import { getActivityMatchingSlotId } from './boardLayout';
import {
  DECK_ACTION_DISCARD,
  DECK_ACTION_DOCK,
  DECK_ACTION_SKIP,
  DECK_ACTION_UNDO,
  DECK_DISCARD_DROP_HINT,
  DECK_DISCARD_LABEL,
  DECK_DISCARD_PANEL_TITLE,
  DECK_DISCARD_TOOLTIP,
  DECK_DOCK_LABEL,
  DECK_DOCK_TOOLTIP,
  DECK_DROP_HINT_BAR,
  DECK_EMPTY_BODY,
  DECK_EMPTY_RESTORE_CTA,
  DECK_EMPTY_SEARCH_CTA,
  DECK_EMPTY_TITLE,
  DECK_EMPTY_VIEW_PLAN_CTA,
  DECK_KEY_LEFT,
  DECK_KEY_RIGHT,
  DECK_KEY_SPACE,
  DECK_KEY_Z,
  DECK_RESTORE_ALL_LABEL,
  DECK_SKIP_LABEL,
  DECK_SKIP_TOOLTIP,
  DECK_SLOT_AVAILABLE_LABEL,
  DECK_SLOT_PICKER_HINT,
  DECK_SLOT_PICKER_TITLE,
  DECK_TIMELINE_PANEL_TITLE,
  DECK_UNDO_LABEL,
  DECK_UNDO_TOOLTIP,
  TIMELINE_SLOTS,
  deckCardsRemaining,
  deckDiscardedCount,
  deckScheduledCount,
  deckSlotPickerChipLabel,
  deckStackCount,
} from './copy';
import { IconCheck, IconClear, IconClose, IconDeckView, IconSkip, IconUndo } from './icons';
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

const SWIPE_THRESHOLD_PX = 70;

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
  const storeDiscardedCards = useBoardStore((state) => state.discardedCards);
  const discardedCards = storeDiscardedCards;
  const undoStack = useBoardStore((state) => state.undoStack);
  const discardCard = useBoardStore((state) => state.discardCard);
  const dockCard = useBoardStore((state) => state.dockCard);
  const undoLastAction = useBoardStore((state) => state.undoLastAction);
  const restoreDiscardedCards = useBoardStore((state) => state.restoreDiscardedCards);
  const setViewMode = useBoardStore((state) => state.setViewMode);

  const [cardIndex, setCardIndex] = useState(0);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [hoveredDropTarget, setHoveredDropTarget] = useState<string | null>(null);
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
    setHoveredDropTarget(null);
    setIsSlotPickerOpen(false);
    discardCard(activeCard.activity.id);
  }, [activeCard, discardCard]);

  const handleSkip = useCallback(() => {
    if (unassignedCards.length <= 1) return;
    setDragOffset(null);
    setHoveredDropTarget(null);
    setIsSlotPickerOpen(false);
    setCardIndex((prev) => prev + 1);
  }, [unassignedCards.length]);

  const handleDockSlot = useCallback(
    (slotId: string) => {
      if (!activeCard) return;
      setDragOffset(null);
      setHoveredDropTarget(null);
      setIsSlotPickerOpen(false);
      dockCard(activeCard.activity.id, slotId, { replace: true });
    },
    [activeCard, dockCard],
  );

  const handleQuickDock = useCallback(() => {
    if (!activeCard) return;
    setDragOffset(null);
    setHoveredDropTarget(null);
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
    setHoveredDropTarget(null);
    setIsSlotPickerOpen(false);
    undoLastAction();
  }, [undoLastAction]);

  // Pointer swipe & drag gestures
  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('button') || target.closest('a')) return;

    event.preventDefault();
    event.stopPropagation();

    dragStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Ignored in test runners or unsupported environments
    }
    setDragOffset({ x: 0, y: 0 });
    setHoveredDropTarget(null);
  };

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!dragStartRef.current || dragStartRef.current.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - dragStartRef.current.x;
    const deltaY = event.clientY - dragStartRef.current.y;
    setDragOffset({ x: deltaX, y: deltaY });

    if (typeof document !== 'undefined' && typeof document.elementFromPoint === 'function') {
      const elem = document.elementFromPoint(event.clientX, event.clientY);
      const targetZone = elem?.closest<HTMLElement>('[data-drop-zone]');
      if (targetZone) {
        const zone = targetZone.dataset.dropZone;
        if (zone === 'discard') {
          setHoveredDropTarget('discard');
        } else if (zone === 'timeslot') {
          setHoveredDropTarget(targetZone.dataset.slotId ?? null);
        } else {
          setHoveredDropTarget(null);
        }
      } else {
        setHoveredDropTarget(null);
      }
    }
  };

  const handlePointerUp = (event: PointerEvent<HTMLElement>) => {
    if (!dragStartRef.current || dragStartRef.current.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - dragStartRef.current.x;
    const target = hoveredDropTarget;
    dragStartRef.current = null;
    setDragOffset(null);
    setHoveredDropTarget(null);

    if (target === 'discard') {
      handleDiscard();
    } else if (target && target !== 'discard') {
      handleDockSlot(target);
    } else if (deltaX < -SWIPE_THRESHOLD_PX) {
      handleDiscard();
    } else if (deltaX > SWIPE_THRESHOLD_PX) {
      handleQuickDock();
    }
  };

  const handlePointerCancel = () => {
    dragStartRef.current = null;
    setDragOffset(null);
    setHoveredDropTarget(null);
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) {
        return;
      }

      if (isSlotPickerOpen && event.key === 'Escape') {
        event.preventDefault();
        setIsSlotPickerOpen(false);
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
  }, [handleDiscard, handleQuickDock, handleSkip, handleUndo, isSlotPickerOpen]);

  const swipeDirection = dragOffset ? (dragOffset.x < -30 ? 'left' : dragOffset.x > 30 ? 'right' : null) : null;

  const cardStyle: CSSProperties | undefined = dragOffset
    ? {
        transform: `translate3d(${dragOffset.x}px, ${dragOffset.y * 0.4}px, 0) rotate(${dragOffset.x * 0.04}deg)`,
        transition: 'none',
        pointerEvents: 'none',
      }
    : undefined;

  const serialIndex = activeCard
    ? cards.findIndex((candidate) => candidate.activity.id === activeCard.activity.id)
    : -1;

  const scheduledSlotsCount = timelineSlots.filter((s) => Boolean(s.activityId)).length;

  return (
    <main className="deck-view">
      {/* Left Column: Discard Bin Drop Target */}
      <aside
        aria-label={DECK_DISCARD_PANEL_TITLE}
        className={`deck-sidebar deck-sidebar--discard${
          hoveredDropTarget === 'discard' || swipeDirection === 'left' ? ' deck-sidebar--active' : ''
        }`}
        data-drop-zone="discard"
        onClick={() => {
          if (activeCard) handleDiscard();
        }}
      >
        <div className="deck-sidebar__header">
          <span className="deck-sidebar__icon-wrap deck-sidebar__icon-wrap--discard">
            <IconClear className="deck-sidebar__icon" />
          </span>
          <div className="deck-sidebar__titles">
            <h2 className="deck-sidebar__title">{DECK_DISCARD_PANEL_TITLE}</h2>
            <span className="deck-sidebar__count">{deckDiscardedCount(discardedCards.length)}</span>
          </div>
        </div>

        <div className="deck-drop-target deck-drop-target--discard">
          <IconClear className="deck-drop-target__icon" />
          <p className="deck-drop-target__label">{DECK_DISCARD_DROP_HINT}</p>
        </div>

        {discardedCards.length > 0 ? (
          <div className="deck-sidebar__footer">
            <button
              className="btn btn--sm btn--subtle deck-sidebar__restore-btn"
              onClick={(e) => {
                e.stopPropagation();
                restoreDiscardedCards();
              }}
              type="button"
            >
              <IconUndo />
              <span>{DECK_RESTORE_ALL_LABEL}</span>
            </button>
          </div>
        ) : null}
      </aside>

      {/* Center Column: Card Stack & Controls */}
      <section className="deck-center">
        {activeCard ? (
          <>
            <div className="deck-view__status-bar">
              <span>{deckStackCount(activeCardIndex + 1, unassignedCards.length)}</span>
              <span>{deckCardsRemaining(unassignedCards.length)}</span>
            </div>

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
                        {deckSlotPickerChipLabel(slot.label, isOccupied)}
                      </button>
                    );
                  })}
                </div>
              </aside>
            ) : null}

            {/* Redesigned Action Controls Bar */}
            <div className="deck-controls" role="toolbar">
              <button
                aria-label={DECK_DISCARD_LABEL}
                className="deck-action-btn deck-action-btn--discard"
                onClick={handleDiscard}
                title={DECK_DISCARD_TOOLTIP}
                type="button"
              >
                <IconClose className="deck-action-btn__icon" />
                <span className="deck-action-btn__text">{DECK_ACTION_DISCARD}</span>
                <kbd className="deck-action-btn__kbd">{DECK_KEY_LEFT}</kbd>
              </button>

              <button
                aria-label={DECK_UNDO_LABEL}
                className="deck-action-btn deck-action-btn--undo"
                disabled={!canUndo}
                onClick={handleUndo}
                title={DECK_UNDO_TOOLTIP}
                type="button"
              >
                <IconUndo className="deck-action-btn__icon" />
                <span className="deck-action-btn__text">{DECK_ACTION_UNDO}</span>
                <kbd className="deck-action-btn__kbd">{DECK_KEY_Z}</kbd>
              </button>

              <button
                aria-label={DECK_SKIP_LABEL}
                className="deck-action-btn deck-action-btn--skip"
                disabled={unassignedCards.length <= 1}
                onClick={handleSkip}
                title={DECK_SKIP_TOOLTIP}
                type="button"
              >
                <IconSkip className="deck-action-btn__icon" />
                <span className="deck-action-btn__text">{DECK_ACTION_SKIP}</span>
                <kbd className="deck-action-btn__kbd">{DECK_KEY_SPACE}</kbd>
              </button>

              <button
                aria-label={DECK_DOCK_LABEL}
                className="deck-action-btn deck-action-btn--dock"
                onClick={handleQuickDock}
                title={DECK_DOCK_TOOLTIP}
                type="button"
              >
                <IconCheck className="deck-action-btn__icon" />
                <span className="deck-action-btn__text">{DECK_ACTION_DOCK}</span>
                <kbd className="deck-action-btn__kbd">{DECK_KEY_RIGHT}</kbd>
              </button>
            </div>

            <p className="deck-controls__hint">{DECK_DROP_HINT_BAR}</p>
          </>
        ) : (
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
        )}
      </section>

      {/* Right Column: Weekend Timeline Slots */}
      <aside aria-label={DECK_TIMELINE_PANEL_TITLE} className="deck-sidebar deck-sidebar--timeline">
        <div className="deck-sidebar__header">
          <span className="deck-sidebar__icon-wrap deck-sidebar__icon-wrap--dock">
            <IconDeckView className="deck-sidebar__icon" />
          </span>
          <div className="deck-sidebar__titles">
            <h2 className="deck-sidebar__title">{DECK_TIMELINE_PANEL_TITLE}</h2>
            <span className="deck-sidebar__count">
              {deckScheduledCount(scheduledSlotsCount, TIMELINE_SLOTS.length)}
            </span>
          </div>
        </div>

        <div className="deck-timeline-slots">
          {TIMELINE_SLOTS.map((slot) => {
            const slotState = timelineSlots.find((s) => s.id === slot.id);
            const bookedCard = slotState?.activityId ? cards.find((c) => c.activity.id === slotState.activityId) : null;
            const isHoveredTarget = hoveredDropTarget === slot.id;

            return (
              <div
                className={`deck-slot-item${bookedCard ? ' deck-slot-item--booked' : ' deck-slot-item--empty'}${
                  isHoveredTarget ? ' deck-slot-item--drop-target' : ''
                }`}
                data-drop-zone="timeslot"
                data-slot-id={slot.id}
                key={slot.id}
                onClick={() => {
                  if (activeCard) {
                    handleDockSlot(slot.id);
                  }
                }}
                role="button"
                tabIndex={0}
                title={slot.label}
              >
                <div className="deck-slot-item__header">
                  <span className="deck-slot-item__label">{slot.label}</span>
                  {bookedCard ? (
                    <span className="deck-slot-item__badge">{bookedCard.activity.location.district}</span>
                  ) : (
                    <span className="deck-slot-item__status">{DECK_SLOT_AVAILABLE_LABEL}</span>
                  )}
                </div>
                {bookedCard ? (
                  <p className="deck-slot-item__title">{bookedCard.activity.title_en ?? bookedCard.activity.title}</p>
                ) : null}
              </div>
            );
          })}
        </div>
      </aside>
    </main>
  );
}
