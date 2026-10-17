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
  DECK_DISCARD_QUEUE_TITLE,
  DECK_DISCARD_RESTORE_TOOLTIP,
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
  DECK_SLOT_DROP_HERE_HINT,
  DECK_SLOT_PICKER_HINT,
  DECK_SLOT_PICKER_TITLE,
  DECK_TIMELINE_PANEL_TITLE,
  DECK_UNDO_LABEL,
  DECK_UNDO_TOOLTIP,
  TIMELINE_SLOTS,
  activityCardSerial,
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
  discardedCards?: MatchedActivity[];
  onFindSimilar?: (match: MatchedActivity) => void;
  onSearchFocus?: () => void;
  onSwitchToBoard?: () => void;
};

const SWIPE_THRESHOLD_PX = 70;
const EXIT_DURATION_MS = 220; // Aligns with --motion-slow (220ms)
const SETTLE_DURATION_MS = 220; // Aligns with --motion-slow (220ms)

export function DeckView({
  cards: propCards,
  timelineSlots: propTimelineSlots,
  discardedCards: propDiscardedCards,
  onFindSimilar,
  onSearchFocus,
  onSwitchToBoard,
}: DeckViewProps) {
  const storeCards = useBoardStore((state) => state.cards);
  const cards = propCards ?? storeCards;
  const storeTimelineSlots = useBoardStore((state) => state.timelineSlots);
  const timelineSlots = propTimelineSlots ?? storeTimelineSlots;
  const storeDiscardedCards = useBoardStore((state) => state.discardedCards);
  const discardedCards = propDiscardedCards ?? storeDiscardedCards;
  const undoStack = useBoardStore((state) => state.undoStack);
  const discardCard = useBoardStore((state) => state.discardCard);
  const dockCard = useBoardStore((state) => state.dockCard);
  const undoLastAction = useBoardStore((state) => state.undoLastAction);
  const restoreDiscardedCards = useBoardStore((state) => state.restoreDiscardedCards);
  const restoreSingleDiscardedCard = useBoardStore((state) => state.restoreSingleDiscardedCard);
  const setViewMode = useBoardStore((state) => state.setViewMode);

  const [cardIndex, setCardIndex] = useState(0);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [hoveredDropTarget, setHoveredDropTarget] = useState<string | null>(null);
  const [isSlotPickerOpen, setIsSlotPickerOpen] = useState(false);
  const [isExiting, setIsExiting] = useState<'left' | 'right' | 'skip' | null>(null);
  const [enteringCard, setEnteringCard] = useState<{
    id: string;
    direction: 'left' | 'right' | 'skip';
    stage: 'initial' | 'settling';
  } | null>(null);

  const animationTimersRef = useRef<{ initialTick?: number; settleComplete?: number }>({});
  const dragStartRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const discardSidebarRef = useRef<HTMLElement | null>(null);
  const discardQueueRef = useRef<HTMLDivElement | null>(null);
  const timelineSidebarRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const timers = animationTimersRef.current;
    return () => {
      if (timers.initialTick) window.clearTimeout(timers.initialTick);
      if (timers.settleComplete) window.clearTimeout(timers.settleComplete);
    };
  }, []);

  const scheduleEnteringCard = useCallback((id: string, direction: 'left' | 'right' | 'skip') => {
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) return;

    if (animationTimersRef.current.initialTick) window.clearTimeout(animationTimersRef.current.initialTick);
    if (animationTimersRef.current.settleComplete) window.clearTimeout(animationTimersRef.current.settleComplete);

    setEnteringCard({ id, direction, stage: 'initial' });

    animationTimersRef.current.initialTick = window.setTimeout(() => {
      setEnteringCard({ id, direction, stage: 'settling' });
    }, 20);

    animationTimersRef.current.settleComplete = window.setTimeout(() => {
      setEnteringCard(null);
    }, SETTLE_DURATION_MS);
  }, []);

  useEffect(() => {
    if (discardQueueRef.current && discardedCards.length > 0) {
      discardQueueRef.current.scrollTop = discardQueueRef.current.scrollHeight;
    }
  }, [discardedCards.length]);

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
  // Two-card depth: crisp next card directly underneath (no faded ghosting)
  const nextCard = unassignedCards.length > 1 ? unassignedCards[(activeCardIndex + 1) % unassignedCards.length] : null;

  const canUndo = undoStack.length > 0;

  // Animated exit runner
  const triggerExit = useCallback((direction: 'left' | 'right' | 'skip', onComplete: () => void) => {
    setIsExiting(direction);
    setDragOffset(null);
    setHoveredDropTarget(null);
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    window.setTimeout(
      () => {
        onComplete();
        setIsExiting(null);
      },
      prefersReducedMotion ? 0 : EXIT_DURATION_MS,
    );
  }, []);

  // Core actions
  const handleDiscard = useCallback(() => {
    if (!activeCard || isExiting) return;
    setIsSlotPickerOpen(false);
    triggerExit('left', () => {
      discardCard(activeCard.activity.id);
    });
  }, [activeCard, discardCard, isExiting, triggerExit]);

  const handleSkip = useCallback(() => {
    if (unassignedCards.length <= 1 || isExiting || !nextCard) return;
    setIsSlotPickerOpen(false);
    const incomingCardId = nextCard.activity.id;
    triggerExit('skip', () => {
      setCardIndex((prev) => prev + 1);
      scheduleEnteringCard(incomingCardId, 'skip');
    });
  }, [isExiting, nextCard, scheduleEnteringCard, triggerExit, unassignedCards.length]);

  const handleRestoreSingle = useCallback(
    (activityId: string) => {
      if (isExiting || enteringCard) return;
      const restored = restoreSingleDiscardedCard(activityId);
      if (restored) {
        setCardIndex(0);
        scheduleEnteringCard(activityId, 'left');
      }
    },
    [enteringCard, isExiting, restoreSingleDiscardedCard, scheduleEnteringCard],
  );

  const handleDockSlot = useCallback(
    (slotId: string) => {
      if (!activeCard || isExiting) return;
      setIsSlotPickerOpen(false);
      triggerExit('right', () => {
        dockCard(activeCard.activity.id, slotId, { replace: true });
      });
    },
    [activeCard, dockCard, isExiting, triggerExit],
  );

  const handleQuickDock = useCallback(() => {
    if (!activeCard || isExiting) return;
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
    setDragOffset(null);
    setHoveredDropTarget(null);
    setIsSlotPickerOpen(true);
  }, [activeCard, handleDockSlot, isExiting, timelineSlots]);

  const handleUndo = useCallback(() => {
    if (isExiting || enteringCard) return;
    const lastAction = undoStack[undoStack.length - 1];
    if (!lastAction) return;

    setDragOffset(null);
    setHoveredDropTarget(null);
    setIsSlotPickerOpen(false);

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      undoLastAction();
      setCardIndex(0);
      return;
    }

    const restoredId = lastAction.type === 'discard' ? lastAction.card.activity.id : lastAction.activityId;
    const direction: 'left' | 'right' = lastAction.type === 'discard' ? 'left' : 'right';

    undoLastAction();
    setCardIndex(0);
    scheduleEnteringCard(restoredId, direction);
  }, [enteringCard, isExiting, scheduleEnteringCard, undoLastAction, undoStack]);

  // Pointer swipe & drag gestures
  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || isExiting) return;
    const target = event.target as HTMLElement;
    if (target.closest('button') || target.closest('a') || target.closest('input')) return;

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
    if (!dragStartRef.current || dragStartRef.current.pointerId !== event.pointerId || isExiting) return;
    const deltaX = event.clientX - dragStartRef.current.x;
    const deltaY = event.clientY - dragStartRef.current.y;
    setDragOffset({ x: deltaX, y: deltaY });

    // Robust bounding rect hit testing for sidebars & timeslots
    const clientX = event.clientX;
    const clientY = event.clientY;

    if (discardSidebarRef.current) {
      const rect = discardSidebarRef.current.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        setHoveredDropTarget('discard');
        return;
      }
    }

    if (timelineSidebarRef.current) {
      const sidebarRect = timelineSidebarRef.current.getBoundingClientRect();
      if (clientX >= sidebarRect.left && clientX <= sidebarRect.right) {
        // Find which slot rect contains clientY
        const slotElements = timelineSidebarRef.current.querySelectorAll<HTMLElement>('[data-slot-id]');
        for (const slotElem of slotElements) {
          const rect = slotElem.getBoundingClientRect();
          if (clientY >= rect.top && clientY <= rect.bottom) {
            setHoveredDropTarget(slotElem.dataset.slotId ?? null);
            return;
          }
        }
      }
    }

    setHoveredDropTarget(null);
  };

  const handlePointerUp = (event: PointerEvent<HTMLElement>) => {
    if (!dragStartRef.current || dragStartRef.current.pointerId !== event.pointerId || isExiting) return;
    const deltaX = event.clientX - dragStartRef.current.x;
    const target = hoveredDropTarget;
    dragStartRef.current = null;

    if (target === 'discard' || deltaX < -SWIPE_THRESHOLD_PX) {
      handleDiscard();
    } else if (target && target !== 'discard') {
      handleDockSlot(target);
    } else if (deltaX > SWIPE_THRESHOLD_PX) {
      handleQuickDock();
    } else {
      setDragOffset(null);
      setHoveredDropTarget(null);
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

  // Dynamic animations & styles
  const isDragging = dragOffset !== null;
  const dragProgress = isDragging ? Math.min(Math.abs(dragOffset.x) / 160, 1) : 0;
  const swipeDirection = isDragging ? (dragOffset.x < -30 ? 'left' : dragOffset.x > 30 ? 'right' : null) : null;

  let stamp: { type: 'discard' | 'dock' | 'skip'; opacity: number } | null = null;
  if (isExiting === 'left') {
    stamp = { type: 'discard', opacity: 1 };
  } else if (isExiting === 'right') {
    stamp = { type: 'dock', opacity: 1 };
  } else if (isExiting === 'skip') {
    stamp = { type: 'skip', opacity: 1 };
  } else if (hoveredDropTarget === 'discard') {
    stamp = { type: 'discard', opacity: 1 };
  } else if (hoveredDropTarget && hoveredDropTarget !== 'discard') {
    stamp = { type: 'dock', opacity: 1 };
  } else if (isDragging) {
    if (dragOffset.x < -24) {
      stamp = { type: 'discard', opacity: Math.min((Math.abs(dragOffset.x) - 24) / 60, 1) };
    } else if (dragOffset.x > 24) {
      stamp = { type: 'dock', opacity: Math.min((dragOffset.x - 24) / 60, 1) };
    }
  }

  let activeCardStyle: CSSProperties | undefined;
  if (enteringCard && activeCard && enteringCard.id === activeCard.activity.id) {
    if (enteringCard.stage === 'initial') {
      activeCardStyle = {
        transform:
          enteringCard.direction === 'skip'
            ? 'translate3d(0, var(--space-4), 0) scale(0.95)'
            : enteringCard.direction === 'left'
              ? 'translate3d(-32rem, 0, 0) scale(0.35) rotate(-10deg)'
              : 'translate3d(32rem, 0, 0) scale(0.35) rotate(10deg)',
        opacity: 0,
        transition: 'none',
      };
    } else {
      activeCardStyle = {
        transform: 'translate3d(0, 0, 0) rotate(0deg) scale(1)',
        opacity: 1,
        transition: 'transform var(--motion-slow) var(--motion-ease), opacity var(--motion-slow) var(--motion-ease)',
      };
    }
  } else if (isExiting === 'left') {
    activeCardStyle = {
      transform: 'translate3d(-32rem, 0, 0) scale(0.35) rotate(-10deg)',
      opacity: 0,
      transition: 'transform var(--motion-slow) var(--motion-ease), opacity var(--motion-slow) var(--motion-ease)',
    };
  } else if (isExiting === 'right') {
    activeCardStyle = {
      transform: 'translate3d(32rem, 0, 0) scale(0.35) rotate(10deg)',
      opacity: 0,
      transition: 'transform var(--motion-slow) var(--motion-ease), opacity var(--motion-slow) var(--motion-ease)',
    };
  } else if (isExiting === 'skip') {
    activeCardStyle = {
      transform: 'translate3d(0, var(--space-8), 0) scale(0.9)',
      opacity: 0,
      transition: 'transform var(--motion-slow) var(--motion-ease), opacity var(--motion-slow) var(--motion-ease)',
    };
  } else if (isDragging) {
    activeCardStyle = {
      transform: `translate3d(${dragOffset.x}px, ${dragOffset.y * 0.3}px, 0) rotate(${dragOffset.x * 0.05}deg) scale(1.02)`,
      boxShadow: 'var(--shadow-drag)',
      transition: 'none',
      willChange: 'transform',
    };
  } else {
    activeCardStyle = {
      transform: 'translate3d(0, 0, 0) rotate(0deg) scale(1)',
      transition: 'transform var(--motion-slow) var(--motion-ease), box-shadow var(--motion-slow) var(--motion-ease)',
    };
  }

  // Next card dynamic scaling physics
  let nextCardStyle: CSSProperties | undefined;
  if (enteringCard && enteringCard.stage === 'initial') {
    nextCardStyle = {
      transform: 'scale(1) translateY(0)',
      transition: 'none',
    };
  } else if (enteringCard && enteringCard.stage === 'settling') {
    nextCardStyle = {
      transform: 'scale(0.96) translateY(var(--space-2))',
      transition: 'transform var(--motion-slow) var(--motion-ease)',
    };
  } else if (isExiting) {
    nextCardStyle = {
      transform: 'scale(1) translateY(0)',
      transition: 'transform var(--motion-slow) var(--motion-ease)',
    };
  } else if (isDragging) {
    nextCardStyle = {
      transform: `scale(${0.96 + dragProgress * 0.04}) translateY(calc(var(--space-2) * ${1 - dragProgress}))`,
      transition: 'none',
    };
  } else {
    nextCardStyle = {
      transform: 'scale(0.96) translateY(var(--space-2))',
      transition: 'transform var(--motion-slow) var(--motion-ease)',
    };
  }

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
        ref={discardSidebarRef}
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

        {discardedCards.length > 0 ? (
          <>
            <div className="deck-drop-target deck-drop-target--discard deck-drop-target--compact">
              <IconClear className="deck-drop-target__icon" />
              <p className="deck-drop-target__label">{DECK_DISCARD_DROP_HINT}</p>
            </div>

            <div aria-label={DECK_DISCARD_QUEUE_TITLE} className="deck-discard-queue" ref={discardQueueRef}>
              {discardedCards.map((card, idx) => {
                const thumb = card.activity.image;
                const title = card.activity.title_en ?? card.activity.title;
                return (
                  <div className="deck-discard-item" key={card.activity.id}>
                    {thumb ? (
                      <img alt="" className="deck-discard-item__thumb" src={thumb} />
                    ) : (
                      <div className="deck-discard-item__thumb-placeholder">{activityCardSerial(idx)}</div>
                    )}
                    <div className="deck-discard-item__content">
                      <span className="deck-discard-item__title" title={title}>
                        {title}
                      </span>
                      <span className="deck-discard-item__district">{card.activity.location.district}</span>
                    </div>
                    <button
                      aria-label={DECK_DISCARD_RESTORE_TOOLTIP}
                      className="deck-discard-item__restore-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRestoreSingle(card.activity.id);
                      }}
                      title={DECK_DISCARD_RESTORE_TOOLTIP}
                      type="button"
                    >
                      <IconUndo className="deck-discard-item__restore-icon" />
                    </button>
                  </div>
                );
              })}
            </div>

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
          </>
        ) : (
          <div className="deck-drop-target deck-drop-target--discard">
            <IconClear className="deck-drop-target__icon" />
            <p className="deck-drop-target__label">{DECK_DISCARD_DROP_HINT}</p>
          </div>
        )}
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
              {nextCard && isExiting !== 'skip' && enteringCard?.direction !== 'skip' ? (
                <div className="deck-stack__item deck-stack__item--next">
                  <DeckCard isGhost match={nextCard} style={nextCardStyle} />
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
                  stamp={stamp}
                  style={activeCardStyle}
                  swipeDirection={swipeDirection}
                />
              </div>
            </div>

            {/* Inline Slot Picker when quick-dock is ambiguous */}
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
      <aside
        aria-label={DECK_TIMELINE_PANEL_TITLE}
        className="deck-sidebar deck-sidebar--timeline"
        ref={timelineSidebarRef}
      >
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
                ) : isHoveredTarget ? (
                  <div className="deck-slot-item__drop-hint">{DECK_SLOT_DROP_HERE_HINT}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      </aside>
    </main>
  );
}
