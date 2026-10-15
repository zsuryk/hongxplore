import { beforeEach, describe, expect, it, vi } from 'vitest';
import agentResponse from '../../docs/examples/agent-response.json';
import { createAgentClient } from './api/client';
import type { components } from './api/schema';
import { getUpcomingWeekendFreeSlots } from './copy';
import { useBoardStore } from './state/boardStore';

const response = agentResponse as components['schemas']['AgentResponse'];

describe('Search and Agent status integration', () => {
  beforeEach(() => {
    useBoardStore.setState({
      agentError: null,
      agentLog: [],
      agentStatus: 'idle',
      cards: [],
      selectedFreeSlotIds: [],
    });
  });

  it('submits search query and free slots to POST /api/agent via client', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => response,
    });

    const client = createAgentClient('live', mockFetch as unknown as typeof fetch);

    useBoardStore.setState({
      selectedFreeSlotIds: ['saturday-morning', 'saturday-afternoon'],
    });

    await useBoardStore.getState().submitSearch('hiking in Sai Kung', client);

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/agent',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }),
    );

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.query).toBe('hiking in Sai Kung');
    expect(callBody.free_slots).toHaveLength(2);
    const expectedMorning = getUpcomingWeekendFreeSlots().find((s) => s.id === 'saturday-morning');
    expect(callBody.free_slots[0].start).toBe(expectedMorning?.start);
    expect(callBody.free_slots[0].end).toBe(expectedMorning?.end);

    expect(useBoardStore.getState().agentStatus).toBe('results');
    expect(useBoardStore.getState().cards).toEqual(response.matches);
    expect(useBoardStore.getState().agentLog).toEqual(response.log);
  });

  it('handles server error response cleanly and sets error state', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    const client = createAgentClient('live', mockFetch as unknown as typeof fetch);

    await useBoardStore.getState().submitSearch('bad query', client);

    expect(useBoardStore.getState().agentStatus).toBe('error');
    expect(useBoardStore.getState().agentError).toContain('500');
  });

  it('supports fixture client with zero network calls', async () => {
    const mockFetch = vi.fn();
    const client = createAgentClient('fixture', mockFetch as unknown as typeof fetch);

    await useBoardStore.getState().submitSearch('seed test', client);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(useBoardStore.getState().agentStatus).toBe('results');
    expect(useBoardStore.getState().cards).toHaveLength(response.matches.length);
  });

  it('locks existing card positions in place when new search results arrive', async () => {
    // 1. Initial response with 2 cards
    const initialResponse: components['schemas']['AgentResponse'] = {
      ...response,
      matches: response.matches.slice(0, 2),
    };
    const client1 = createAgentClient(
      'live',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => initialResponse,
      }) as unknown as typeof fetch,
    );

    await useBoardStore.getState().submitSearch('initial search', client1);

    const initialPositions = { ...useBoardStore.getState().cardPositions };
    const initialCard0Id = response.matches[0].activity.id;
    const initialCard1Id = response.matches[1].activity.id;

    expect(initialPositions[initialCard0Id]).toBeDefined();
    expect(initialPositions[initialCard1Id]).toBeDefined();

    // 2. Subsequent search that adds a new card
    const newCard = {
      ...response.matches[0],
      activity: {
        ...response.matches[0].activity,
        id: 'new-activity-unique-id',
        title: 'New Unique Activity',
      },
    };
    const secondResponse: components['schemas']['AgentResponse'] = {
      ...response,
      matches: [response.matches[0], response.matches[2], newCard],
    };
    const client2 = createAgentClient(
      'live',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => secondResponse,
      }) as unknown as typeof fetch,
    );

    await useBoardStore.getState().submitSearch('second search', client2);

    const updatedPositions = useBoardStore.getState().cardPositions;

    // Existing cards must remain at their exact original positions
    expect(updatedPositions[initialCard0Id]).toEqual(initialPositions[initialCard0Id]);
    expect(updatedPositions[initialCard1Id]).toEqual(initialPositions[initialCard1Id]);

    // Newly added cards must have assigned positions
    expect(updatedPositions[response.matches[2].activity.id]).toBeDefined();
    expect(updatedPositions['new-activity-unique-id']).toBeDefined();
  });
});
