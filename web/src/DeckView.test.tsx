import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import agentResponse from '../../docs/examples/agent-response.json';
import { DeckView } from './DeckView';
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
});
