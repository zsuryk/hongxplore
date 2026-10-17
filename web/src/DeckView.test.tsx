import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import agentResponse from '../../docs/examples/agent-response.json';
import { DeckView } from './DeckView';
import {
  computeDynamicDragScale,
  findRestoredCardIndex,
  isHorizontalSwipeGesture,
  isVerticalScrollIntent,
  resolveSwipeOutcome,
} from './deckPhysics';
import type { components } from './api/schema';
import { useBoardStore } from './state/boardStore';
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
  DECK_DOCK_LABEL,
  DECK_DROP_HINT_BAR,
  DECK_EMPTY_RESTORE_CTA,
  DECK_EMPTY_SEARCH_CTA,
  DECK_EMPTY_TITLE,
  DECK_EMPTY_VIEW_PLAN_CTA,
  DECK_KEY_LEFT,
  DECK_KEY_RIGHT,
  DECK_KEY_SPACE,
  DECK_KEY_Z,
  DECK_SKIP_LABEL,
  DECK_SLOT_DISCARD_TOOLTIP,
  DECK_SLOT_INCOMPATIBLE_LABEL,
  DECK_TIMELINE_PANEL_TITLE,
  DECK_UNDO_LABEL,
  TIMELINE_SLOTS,
} from './copy';

const response = agentResponse as components['schemas']['AgentResponse'];

describe('DeckView', () => {
  beforeEach(() => {
    useBoardStore.setState({
      cards: [...response.matches],
      discardedCards: [],
      timelineSlots: TIMELINE_SLOTS.map((s) => ({ id: s.id, activityId: null })),
      viewMode: 'deck',
      undoStack: [],
    });
  });

  it('renders three-column layout: discard bin, top unassigned card, controls, and timeline panel', () => {
    const markup = renderToStaticMarkup(<DeckView cards={response.matches} />);

    const firstCardTitle = response.matches[0].activity.title_en ?? response.matches[0].activity.title;
    expect(markup).toContain(firstCardTitle);
    expect(markup).toContain(`1 of ${response.matches.length}`);
    expect(markup).toContain(`${response.matches.length} remaining`);

    // Left sidebar (Discard bin)
    expect(markup).toContain(DECK_DISCARD_PANEL_TITLE);
    expect(markup).toContain(DECK_DISCARD_DROP_HINT);
    expect(markup).toContain('data-drop-zone="discard"');

    // Right sidebar (Weekend schedule)
    expect(markup).toContain(DECK_TIMELINE_PANEL_TITLE);
    expect(markup).toContain('data-drop-zone="timeslot"');

    // Redesigned Action Controls
    expect(markup).toContain(DECK_DISCARD_LABEL);
    expect(markup).toContain(DECK_ACTION_DISCARD);
    expect(markup).toContain(DECK_KEY_LEFT);

    expect(markup).toContain(DECK_UNDO_LABEL);
    expect(markup).toContain(DECK_ACTION_UNDO);
    expect(markup).toContain(DECK_KEY_Z);

    expect(markup).toContain(DECK_SKIP_LABEL);
    expect(markup).toContain(DECK_ACTION_SKIP);
    expect(markup).toContain(DECK_KEY_SPACE);

    expect(markup).toContain(DECK_DOCK_LABEL);
    expect(markup).toContain(DECK_ACTION_DOCK);
    expect(markup).toContain(DECK_KEY_RIGHT);

    expect(markup).toContain(DECK_DROP_HINT_BAR);
  });

  it('renders empty completion state when all cards are triaged while retaining sidebar context', () => {
    const markup = renderToStaticMarkup(<DeckView cards={[]} />);

    expect(markup).toContain(DECK_EMPTY_TITLE);
    expect(markup).toContain(DECK_EMPTY_VIEW_PLAN_CTA);
    expect(markup).toContain(DECK_EMPTY_RESTORE_CTA);
    expect(markup).toContain(DECK_DISCARD_PANEL_TITLE);
    expect(markup).toContain(DECK_TIMELINE_PANEL_TITLE);
  });

  it('renders search CTA in empty completion state when onSearchFocus is provided', () => {
    const markup = renderToStaticMarkup(<DeckView cards={[]} onSearchFocus={() => {}} />);
    expect(markup).toContain(DECK_EMPTY_SEARCH_CTA);
  });

  it('excludes docked cards from unassigned cards in deck stack', () => {
    const dockedCard = response.matches[0];
    const testSlots = TIMELINE_SLOTS.map((s, idx) =>
      idx === 0 ? { id: s.id, activityId: dockedCard.activity.id } : { id: s.id, activityId: null },
    );

    const markup = renderToStaticMarkup(<DeckView cards={response.matches} timelineSlots={testSlots} />);

    const secondCardTitle = response.matches[1].activity.title_en ?? response.matches[1].activity.title;
    // Should show second card as the top unassigned card
    expect(markup).toContain(secondCardTitle);
    expect(markup).toContain(`1 of ${response.matches.length - 1}`);

    // Docked card title should appear in right timeline sidebar
    expect(markup).toContain(dockedCard.activity.title_en ?? dockedCard.activity.title);
  });

  it('renders discard queue with mini cards and individual restore buttons when discarded cards exist', () => {
    const discardedCard = response.matches[0];
    useBoardStore.setState({
      cards: response.matches.slice(1),
      discardedCards: [discardedCard],
    });

    const markup = renderToStaticMarkup(
      <DeckView cards={response.matches.slice(1)} discardedCards={[discardedCard]} />,
    );

    expect(markup).toContain(DECK_DISCARD_QUEUE_TITLE);
    expect(markup).toContain('deck-discard-item');
    expect(markup).toContain(discardedCard.activity.title_en ?? discardedCard.activity.title);
    expect(markup).toContain(DECK_DISCARD_RESTORE_TOOLTIP);
  });

  describe('gesture physics and threshold logic', () => {
    it('resolves flick past negative threshold as discard', () => {
      expect(resolveSwipeOutcome(-75, null)).toEqual({ type: 'discard' });
      expect(resolveSwipeOutcome(-120, null)).toEqual({ type: 'discard' });
    });

    it('resolves discard drop target as discard regardless of horizontal distance', () => {
      expect(resolveSwipeOutcome(10, 'discard')).toEqual({ type: 'discard' });
      expect(resolveSwipeOutcome(-20, 'discard')).toEqual({ type: 'discard' });
    });

    it('resolves flick past positive threshold as quick-dock', () => {
      expect(resolveSwipeOutcome(75, null)).toEqual({ type: 'quick-dock' });
      expect(resolveSwipeOutcome(160, null)).toEqual({ type: 'quick-dock' });
    });

    it('resolves hovered timeslot target as dock to specific slot', () => {
      expect(resolveSwipeOutcome(15, 'saturday-afternoon')).toEqual({
        type: 'dock',
        slotId: 'saturday-afternoon',
      });
      expect(resolveSwipeOutcome(-10, 'sunday-morning')).toEqual({
        type: 'dock',
        slotId: 'sunday-morning',
      });
    });

    it('cancels drag when displacement is sub-threshold and no target hovered', () => {
      expect(resolveSwipeOutcome(40, null)).toEqual({ type: 'cancel' });
      expect(resolveSwipeOutcome(-50, null)).toEqual({ type: 'cancel' });
      expect(resolveSwipeOutcome(0, null)).toEqual({ type: 'cancel' });
    });

    it('distinguishes horizontal swipe gestures from vertical scroll intent', () => {
      // Clear horizontal swipe
      expect(isHorizontalSwipeGesture(45, 5)).toBe(true);
      expect(isHorizontalSwipeGesture(-60, 10)).toBe(true);

      // Dominant vertical scroll
      expect(isHorizontalSwipeGesture(5, 45)).toBe(false);
      expect(isHorizontalSwipeGesture(-10, 60)).toBe(false);

      // Jitter / deadzone
      expect(isHorizontalSwipeGesture(4, 2)).toBe(false);
      expect(isHorizontalSwipeGesture(0, 0)).toBe(false);

      // Dedicated vertical scroll intent check (requires dominant vertical displacement)
      expect(isVerticalScrollIntent(4, 25)).toBe(true);
      expect(isVerticalScrollIntent(-5, 30)).toBe(true);

      // Diagonal or horizontal swipe should NOT be classified as vertical scroll intent
      expect(isVerticalScrollIntent(-15, 14)).toBe(false);
      expect(isVerticalScrollIntent(40, 20)).toBe(false);
      expect(isVerticalScrollIntent(0, 10)).toBe(false); // below threshold
    });

    it('resolves fast flick below static distance threshold using velocity', () => {
      // 45px left flick at high velocity (-0.5 px/ms) -> discard
      expect(resolveSwipeOutcome(-45, null, 70, -0.5)).toEqual({ type: 'discard' });

      // 45px right flick at high velocity (+0.5 px/ms) -> quick-dock
      expect(resolveSwipeOutcome(45, null, 70, 0.5)).toEqual({ type: 'quick-dock' });

      // Sub-threshold drag with low velocity (0.1 px/ms) -> cancel
      expect(resolveSwipeOutcome(45, null, 70, 0.1)).toEqual({ type: 'cancel' });
      expect(resolveSwipeOutcome(-45, null, 70, -0.1)).toEqual({ type: 'cancel' });
    });

    it('identifies the exact index of restored card in unassigned stack', () => {
      const cards = response.matches.slice(0, 4);
      const targetId = cards[2].activity.id;

      expect(findRestoredCardIndex(cards, targetId)).toBe(2);
      expect(findRestoredCardIndex(cards, 'non-existent-id')).toBe(0);
    });

    it('computes dynamic scale proportionally as card drags towards sidebars without jumping on hover', () => {
      // At rest (deltaX = 0), scale is 1.0
      expect(computeDynamicDragScale(0)).toBe(1);

      // Halfway drag (130px), scale shrinks proportionally
      expect(computeDynamicDragScale(130)).toBe(0.775);
      expect(computeDynamicDragScale(-130)).toBe(0.775);

      // Max drag threshold (260px or more)
      expect(computeDynamicDragScale(260)).toBe(0.55);
      expect(computeDynamicDragScale(400)).toBe(0.55);

      // Scale is continuous and derived purely from deltaX (never jumping on hover)
      expect(computeDynamicDragScale(100)).toBe(0.827);
    });

    it('leaves timeslots neutral at rest and flags incompatible (red) only when dragging', () => {
      const markup = renderToStaticMarkup(<DeckView cards={response.matches} />);

      // At rest, timeslots are neutral and clean (not flagged red)
      expect(markup).not.toContain('deck-slot-item--incompatible');
      expect(markup).not.toContain(DECK_SLOT_INCOMPATIBLE_LABEL);
      expect(markup).not.toContain('data-incompatible="true"');
    });

    it('renders a discard button on booked timeslots to discard activity from slot', () => {
      const bookedCard = response.matches[0];
      const testSlots = TIMELINE_SLOTS.map((s, idx) =>
        idx === 0 ? { id: s.id, activityId: bookedCard.activity.id } : { id: s.id, activityId: null },
      );

      const markup = renderToStaticMarkup(<DeckView cards={response.matches} timelineSlots={testSlots} />);

      expect(markup).toContain('deck-slot-item__discard-btn');
      expect(markup).toContain(DECK_SLOT_DISCARD_TOOLTIP);
    });
  });
});
