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
    const requestAgent = vi.fn().mockResolvedValue(response);
    const client: AgentClient = { requestAgent };

    const result = await useBoardStore.getState().findSimilar(card, client);

    expect(result).toBe(true);
    expect(requestAgent).toHaveBeenCalledWith({
      query: expect.stringContaining('Hong Kong Heritage Discovery Centre guided tour'),
    });
    expect(requestAgent).toHaveBeenCalledWith({
      query: expect.stringContaining('Yau Tsim Mong'),
    });
    expect(useBoardStore.getState().cards).toHaveLength(response.matches.length);
    expect(useBoardStore.getState().lastMatchCount).toBe(response.matches.length);
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
});
