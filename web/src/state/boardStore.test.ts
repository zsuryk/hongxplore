import { beforeEach, describe, expect, it, vi } from 'vitest';
import agentResponse from '../../../docs/examples/agent-response.json';
import type { AgentClient } from '../api/client';
import type { components } from '../api/schema';
import { useBoardStore } from './boardStore';

const response = agentResponse as components['schemas']['AgentResponse'];

const slots = [
  { id: 'saturday-afternoon', activityId: null },
  { id: 'saturday-evening', activityId: null },
];

describe('board store timeline docking', () => {
  beforeEach(() => {
    useBoardStore.setState({
      timelineSlots: slots,
    });
  });

  it('docks an activity in an available timeline slot', () => {
    expect(useBoardStore.getState().dockCard('activity-one', 'saturday-afternoon')).toBe(true);
    expect(useBoardStore.getState().timelineSlots).toEqual([
      { id: 'saturday-afternoon', activityId: 'activity-one' },
      { id: 'saturday-evening', activityId: null },
    ]);
  });

  it('rejects an occupied timeline slot and preserves its existing card', () => {
    useBoardStore.setState({
      timelineSlots: [{ id: 'saturday-afternoon', activityId: 'activity-one' }],
    });

    expect(useBoardStore.getState().dockCard('activity-two', 'saturday-afternoon')).toBe(false);
    expect(useBoardStore.getState().timelineSlots[0]?.activityId).toBe('activity-one');
  });

  it('replaces an occupied timeline slot when replace option is provided', () => {
    useBoardStore.setState({
      timelineSlots: [{ id: 'saturday-afternoon', activityId: 'activity-one' }],
    });

    expect(useBoardStore.getState().dockCard('activity-two', 'saturday-afternoon', { replace: true })).toBe(true);
    expect(useBoardStore.getState().timelineSlots[0]?.activityId).toBe('activity-two');
  });

  it('moves a docked activity to another available timeline slot', () => {
    useBoardStore.getState().dockCard('activity-one', 'saturday-afternoon');

    expect(useBoardStore.getState().dockCard('activity-one', 'saturday-evening')).toBe(true);
    expect(useBoardStore.getState().timelineSlots).toEqual([
      { id: 'saturday-afternoon', activityId: null },
      { id: 'saturday-evening', activityId: 'activity-one' },
    ]);
  });

  it('undocks an activity from a timeline slot', () => {
    useBoardStore.setState({
      timelineSlots: [{ id: 'saturday-afternoon', activityId: 'activity-one' }],
    });

    useBoardStore.getState().undockCard('saturday-afternoon');
    expect(useBoardStore.getState().timelineSlots[0]?.activityId).toBeNull();
  });
});

describe('board store discard and similar flows', () => {
  beforeEach(() => {
    useBoardStore.setState({
      agentLog: [],
      cards: response.matches,
      discardedCards: [],
      timelineSlots: [],
      viewport: { x: 0, y: 0, scale: 1 },
    });
  });

  it('removes a discarded card from the board while preserving it in discarded cards', () => {
    const card = response.matches[0];

    useBoardStore.getState().discardCard(card.activity.id);

    expect(useBoardStore.getState().cards).not.toContain(card);
    expect(useBoardStore.getState().discardedCards).toContain(card);
  });

  it('requests similar activities using the selected card as the seed', async () => {
    const card = response.matches[0];
    const newSimilarMatch = {
      ...response.matches[1],
      activity: {
        ...response.matches[1].activity,
        id: 'new-similar-activity-id',
        title: 'New Similar Activity',
      },
    };
    const newResponse = {
      ...response,
      matches: [newSimilarMatch],
    };
    const requestAgent = vi.fn().mockResolvedValue(newResponse);
    const client: AgentClient = { requestAgent };

    const initialCount = useBoardStore.getState().cards.length;
    const result = await useBoardStore.getState().findSimilar(card, client);

    expect(result).toBe(true);
    expect(requestAgent).toHaveBeenCalledWith({
      query: expect.stringContaining('Hong Kong Heritage Discovery Centre guided tour'),
      mode: 'demo',
    });
    expect(requestAgent).toHaveBeenCalledWith({
      query: expect.stringContaining('Yau Tsim Mong'),
      mode: 'demo',
    });
    expect(useBoardStore.getState().cards).toHaveLength(initialCount + 1);
    expect(useBoardStore.getState().lastMatchCount).toBe(1);
    expect(useBoardStore.getState().recentCardIds).toEqual(['new-similar-activity-id']);
  });

  it('records an error log entry and updates status when findSimilar fails', async () => {
    const card = response.matches[0];
    const client: AgentClient = {
      requestAgent: vi.fn().mockRejectedValue(new Error('Agent request failed with status 502')),
    };

    const result = await useBoardStore.getState().findSimilar(card, client);

    expect(result).toBe(false);
    const state = useBoardStore.getState();
    expect(state.agentStatus).toBe('error');
    expect(state.agentError).toContain('502');
    expect(state.lastMatchCount).toBeNull();
    expect(state.agentLog.length).toBeGreaterThan(0);
    expect(state.agentLog.some((entry) => entry.level === 'error' && entry.message.includes('502'))).toBe(true);
  });

  it('returns false and sets lastMatchCount to 0 when findSimilar yields no new cards', async () => {
    // Set the board to already contain all matches from the response
    useBoardStore.setState({
      cards: response.matches,
      discardedCards: [],
      recentCardIds: [],
    });

    const card = response.matches[0];
    const client: AgentClient = {
      requestAgent: vi.fn().mockResolvedValue(response),
    };

    const result = await useBoardStore.getState().findSimilar(card, client);

    expect(result).toBe(false);
    const state = useBoardStore.getState();
    expect(state.cards).toHaveLength(response.matches.length);
    expect(state.lastMatchCount).toBe(0);
    expect(state.recentCardIds).toHaveLength(0);
    expect(state.agentStatus).toBe('results');
    expect(
      state.agentLog.some(
        (e) => e.message.toLowerCase().includes('no new') || e.message.toLowerCase().includes('no unplaced'),
      ),
    ).toBe(true);
  });
});

describe('board store search retrieval and error handling', () => {
  beforeEach(() => {
    useBoardStore.setState({
      agentError: null,
      agentLog: [],
      agentStatus: 'idle',
      cards: [],
      dataSourceMode: 'live',
      discardedCards: [],
      lastMatchCount: null,
      timelineSlots: [],
    });
  });

  it('merges new search results with existing cards instead of erasing them', async () => {
    useBoardStore.setState({
      cards: [response.matches[0]],
    });

    const client: AgentClient = {
      requestAgent: vi.fn().mockResolvedValue(response),
    };

    await useBoardStore.getState().submitSearch('hiking in Kowloon', client);

    const state = useBoardStore.getState();
    expect(state.agentStatus).toBe('results');
    // Original card + incoming cards merged without duplicates
    expect(state.cards).toHaveLength(response.matches.length);
    expect(state.lastMatchCount).toBe(response.matches.length);
    expect(state.cards.some((c) => c.activity.id === response.matches[0].activity.id)).toBe(true);
  });

  it('formats HTTP 502 into a user-friendly error and appends an error log entry', async () => {
    const client: AgentClient = {
      requestAgent: vi.fn().mockRejectedValue(new Error('Agent request failed with status 502')),
    };

    await useBoardStore.getState().submitSearch('bad query', client);

    const state = useBoardStore.getState();
    expect(state.agentStatus).toBe('error');
    expect(state.agentError).toContain('502');
    expect(state.agentError).toContain('Backend service is unavailable');
    expect(state.agentLog).toHaveLength(1);
    expect(state.agentLog[0].level).toBe('error');
    expect(state.agentLog[0].message).toContain('502');
  });

  it('exclusively glows newly added cards and excludes cards that already exist', async () => {
    const client: AgentClient = {
      requestAgent: vi.fn().mockResolvedValue(response),
    };

    await useBoardStore.getState().submitSearch('first query', client);
    expect(useBoardStore.getState().recentCardIds).toEqual(response.matches.map((m) => m.activity.id));

    // Second search returns an existing card PLUS a brand new card
    const brandNewCard = {
      ...response.matches[0],
      activity: { ...response.matches[0].activity, id: 'brand-new-unique-id' },
    };
    const secondResponse = {
      ...response,
      matches: [response.matches[0], brandNewCard],
    };
    const secondClient: AgentClient = {
      requestAgent: vi.fn().mockResolvedValue(secondResponse),
    };

    await useBoardStore.getState().submitSearch('second query', secondClient);
    // Only the brand-new card glows; the already-existing card does NOT glow
    expect(useBoardStore.getState().recentCardIds).toEqual(['brand-new-unique-id']);
  });

  describe('board store clear board and confirmation', () => {
    beforeEach(() => {
      useBoardStore.setState({
        cards: response.matches,
        discardedCards: [response.matches[0]],
        isClearConfirmOpen: false,
        recentCardIds: ['activity-1'],
        timelineSlots: [
          { id: 'saturday-afternoon', activityId: 'activity-1' },
          { id: 'saturday-evening', activityId: null },
        ],
        agentStatus: 'results',
        lastMatchCount: 5,
      });
    });

    it('manages confirmation dialog open and cancel lifecycle', () => {
      expect(useBoardStore.getState().isClearConfirmOpen).toBe(false);

      useBoardStore.getState().requestClearBoard();
      expect(useBoardStore.getState().isClearConfirmOpen).toBe(true);

      useBoardStore.getState().cancelClearBoard();
      expect(useBoardStore.getState().isClearConfirmOpen).toBe(false);
    });

    it('clears all cards, timeline slots, discarded cards, and resets status on confirmClearBoard', () => {
      useBoardStore.getState().requestClearBoard();
      expect(useBoardStore.getState().isClearConfirmOpen).toBe(true);

      useBoardStore.getState().confirmClearBoard();

      const state = useBoardStore.getState();
      expect(state.cards).toEqual([]);
      expect(state.discardedCards).toEqual([]);
      expect(state.recentCardIds).toEqual([]);
      expect(state.timelineSlots.every((slot) => slot.activityId === null)).toBe(true);
      expect(state.isClearConfirmOpen).toBe(false);
      expect(state.agentStatus).toBe('idle');
      expect(state.agentError).toBeNull();
      expect(state.lastMatchCount).toBeNull();
    });

    it('clears board directly when clearBoard action is called', () => {
      useBoardStore.getState().clearBoard();

      const state = useBoardStore.getState();
      expect(state.cards).toHaveLength(0);
      expect(state.timelineSlots.every((slot) => slot.activityId === null)).toBe(true);
      expect(state.agentStatus).toBe('idle');
      expect(state.cardZIndexById).toEqual({});
    });
  });

  describe('card stacking hierarchy (#133)', () => {
    beforeEach(() => {
      useBoardStore.setState({
        cardPositions: {},
        cardZIndexById: {},
        cards: response.matches,
      });
    });

    it('promotes grabbed card above untouched cards (z-index > 1)', () => {
      const cardA = response.matches[0].activity.id;
      useBoardStore.getState().bringCardToFront(cardA);

      expect(useBoardStore.getState().cardZIndexById[cardA]).toBe(2);
    });

    it('promotes consecutively grabbed and dropped cards with increasing precedence', () => {
      const cardA = response.matches[0].activity.id;
      const cardB = response.matches[1].activity.id;
      const cardC = response.matches[2].activity.id;

      useBoardStore.getState().bringCardToFront(cardA);
      expect(useBoardStore.getState().cardZIndexById[cardA]).toBe(2);

      useBoardStore.getState().setCardPosition(cardB, { x: 100, y: 100 });
      expect(useBoardStore.getState().cardZIndexById[cardB]).toBe(3);

      useBoardStore.getState().bringCardToFront(cardA);
      expect(useBoardStore.getState().cardZIndexById[cardA]).toBe(4);

      useBoardStore.getState().bringCardToFront(cardC);
      expect(useBoardStore.getState().cardZIndexById[cardC]).toBe(5);

      // Card C is highest, then Card A, then Card B
      const z = useBoardStore.getState().cardZIndexById;
      expect(z[cardC]).toBeGreaterThan(z[cardA]);
      expect(z[cardA]).toBeGreaterThan(z[cardB]);
    });

    it('cleans up cardZIndexById entry when card is discarded', () => {
      const cardA = response.matches[0].activity.id;
      useBoardStore.getState().bringCardToFront(cardA);
      expect(useBoardStore.getState().cardZIndexById[cardA]).toBe(2);

      useBoardStore.getState().discardCard(cardA);
      expect(useBoardStore.getState().cardZIndexById[cardA]).toBeUndefined();
    });
  });

  describe('view mode and undo actions', () => {
    const memoryStorage = new Map<string, string>();
    const localStorageMock = {
      getItem: (key: string) => memoryStorage.get(key) ?? null,
      setItem: (key: string, val: string) => memoryStorage.set(key, val),
      removeItem: (key: string) => memoryStorage.delete(key),
      clear: () => memoryStorage.clear(),
      key: (i: number) => Array.from(memoryStorage.keys())[i] ?? null,
      length: 0,
    };

    beforeEach(() => {
      vi.stubGlobal('localStorage', localStorageMock);
      localStorageMock.clear();
      useBoardStore.setState({
        cards: [...response.matches],
        discardedCards: [],
        timelineSlots: slots.map((s) => ({ ...s, activityId: null })),
        viewMode: 'board',
        undoStack: [],
      });
    });

    it('defaults to board view mode and switches to deck view mode', () => {
      expect(useBoardStore.getState().viewMode).toBe('board');
      useBoardStore.getState().setViewMode('deck');
      expect(useBoardStore.getState().viewMode).toBe('deck');
      expect(localStorage.getItem('hongxplore:view-mode')).toBe('deck');

      useBoardStore.getState().setViewMode('board');
      expect(useBoardStore.getState().viewMode).toBe('board');
      expect(localStorage.getItem('hongxplore:view-mode')).toBe('board');
    });

    it('undoes a discard action, restoring the card back to active cards', () => {
      const card = response.matches[0];
      const initialCount = useBoardStore.getState().cards.length;

      useBoardStore.getState().discardCard(card.activity.id);
      expect(useBoardStore.getState().cards.length).toBe(initialCount - 1);
      expect(useBoardStore.getState().discardedCards).toContainEqual(card);

      const undone = useBoardStore.getState().undoLastAction();
      expect(undone).toBe(true);
      expect(useBoardStore.getState().cards.some((c) => c.activity.id === card.activity.id)).toBe(true);
      expect(useBoardStore.getState().discardedCards.some((c) => c.activity.id === card.activity.id)).toBe(false);
    });

    it('undoes a dock action, restoring the timeline slot', () => {
      const card = response.matches[0];
      useBoardStore.getState().dockCard(card.activity.id, 'saturday-afternoon');
      expect(useBoardStore.getState().timelineSlots[0].activityId).toBe(card.activity.id);

      const undone = useBoardStore.getState().undoLastAction();
      expect(undone).toBe(true);
      expect(useBoardStore.getState().timelineSlots[0].activityId).toBeNull();
    });

    it('restores replaced card when undoing a replacing dock action', () => {
      const card1 = response.matches[0];
      const card2 = response.matches[1];

      useBoardStore.getState().dockCard(card1.activity.id, 'saturday-afternoon');
      useBoardStore.getState().dockCard(card2.activity.id, 'saturday-afternoon', { replace: true });
      expect(useBoardStore.getState().timelineSlots[0].activityId).toBe(card2.activity.id);

      const undone = useBoardStore.getState().undoLastAction();
      expect(undone).toBe(true);
      expect(useBoardStore.getState().timelineSlots[0].activityId).toBe(card1.activity.id);
    });

    it('returns false when undoing with empty undo stack', () => {
      expect(useBoardStore.getState().undoLastAction()).toBe(false);
    });

    it('restores all discarded cards back to cards array', () => {
      const card1 = response.matches[0];
      const card2 = response.matches[1];
      useBoardStore.getState().discardCard(card1.activity.id);
      useBoardStore.getState().discardCard(card2.activity.id);
      expect(useBoardStore.getState().discardedCards.length).toBe(2);

      useBoardStore.getState().restoreDiscardedCards();
      expect(useBoardStore.getState().discardedCards.length).toBe(0);
      expect(useBoardStore.getState().cards.some((c) => c.activity.id === card1.activity.id)).toBe(true);
      expect(useBoardStore.getState().cards.some((c) => c.activity.id === card2.activity.id)).toBe(true);
    });
  });
});
