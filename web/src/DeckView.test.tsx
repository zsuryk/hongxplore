import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import agentResponse from '../../docs/examples/agent-response.json';
import { DeckView } from './DeckView';
import type { components } from './api/schema';
import { useBoardStore } from './state/boardStore';
import {
  DECK_DISCARD_LABEL,
  DECK_DOCK_LABEL,
  DECK_EMPTY_RESTORE_CTA,
  DECK_EMPTY_TITLE,
  DECK_EMPTY_VIEW_PLAN_CTA,
  DECK_KEYBOARD_HINT,
  DECK_SKIP_LABEL,
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

  it('renders the top unassigned card, controls, and stack progress counter', () => {
    const markup = renderToStaticMarkup(<DeckView cards={response.matches} />);

    const firstCardTitle = response.matches[0].activity.title_en ?? response.matches[0].activity.title;
    expect(markup).toContain(firstCardTitle);
    expect(markup).toContain(`1 of ${response.matches.length}`);
    expect(markup).toContain(`${response.matches.length} remaining`);

    // Controls
    expect(markup).toContain(DECK_DISCARD_LABEL);
    expect(markup).toContain(DECK_UNDO_LABEL);
    expect(markup).toContain(DECK_SKIP_LABEL);
    expect(markup).toContain(DECK_DOCK_LABEL);
    expect(markup).toContain(DECK_KEYBOARD_HINT);
  });

  it('renders empty completion state when all cards are triaged', () => {
    const markup = renderToStaticMarkup(<DeckView cards={[]} />);

    expect(markup).toContain(DECK_EMPTY_TITLE);
    expect(markup).toContain(DECK_EMPTY_VIEW_PLAN_CTA);
    expect(markup).toContain(DECK_EMPTY_RESTORE_CTA);
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
  });
});
