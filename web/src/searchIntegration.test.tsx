import { beforeEach, describe, expect, it, vi } from 'vitest';
import agentResponse from '../../docs/examples/agent-response.json';
import { createAgentClient } from './api/client';
import type { components } from './api/schema';
import { getUpcomingWeekendFreeSlots, INITIAL_ACTIVITY_QUERY } from './copy';
import { useBoardStore } from './state/boardStore';

const response = agentResponse as components['schemas']['AgentResponse'];
const PITCH_KEY = 'hx-pitch-key-2026';

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

    const client = createAgentClient({ mode: 'demo' }, mockFetch as unknown as typeof fetch);

    const fridayRef = new Date('2026-10-16T10:00:00Z');
    const availableSlots = getUpcomingWeekendFreeSlots(fridayRef);
    const slot1 = availableSlots.find((s) => s.id === 'saturday-morning')!;
    const slot2 = availableSlots.find((s) => s.id === 'saturday-afternoon')!;

    useBoardStore.setState({
      selectedFreeSlotIds: [slot1.id, slot2.id],
    });

    await useBoardStore.getState().submitSearch('hiking in Sai Kung', client, { referenceTime: fridayRef });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/agent',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }),
    );

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.query).toBe('hiking in Sai Kung');
    expect(callBody.mode).toBe('demo');
    expect(callBody.free_slots).toHaveLength(2);
    expect(callBody.free_slots[0].start).toBe(slot1.start);
    expect(callBody.free_slots[0].end).toBe(slot1.end);

    expect(useBoardStore.getState().agentStatus).toBe('results');
    expect(useBoardStore.getState().cards).toEqual(response.matches);
    expect(useBoardStore.getState().agentLog).toEqual(response.log);
  });

  describe('live mode and the agent access key (issue #83)', () => {
    function deniedFetch(status: number, reason: string) {
      return vi.fn().mockResolvedValue({
        ok: false,
        status,
        json: async () => ({ detail: { reason, message: `server says ${reason}` } }),
      });
    }

    it('a live request with a valid key is served and carries the key', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => response,
      });
      const client = createAgentClient(
        { mode: 'live', agentAccessKey: PITCH_KEY },
        mockFetch as unknown as typeof fetch,
      );

      await useBoardStore.getState().submitSearch('badminton in Wan Chai', client);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.mode).toBe('live');
      expect(body.agent_access_key).toBe(PITCH_KEY);
      expect(useBoardStore.getState().agentStatus).toBe('results');
    });

    it.each([
      [401, 'missing_key', /paste it/i],
      [403, 'invalid_key', /not recognised/i],
    ])(
      'a refused live request (%s %s) shows its own copy and never silently downgrades',
      async (status, reason, expectedCopy) => {
        const mockFetch = deniedFetch(status as number, reason as string);
        const client = createAgentClient(
          { mode: 'live', agentAccessKey: 'whatever' },
          mockFetch as unknown as typeof fetch,
        );

        await useBoardStore.getState().submitSearch('badminton in Wan Chai', client);

        expect(useBoardStore.getState().agentStatus).toBe('error');
        expect(useBoardStore.getState().agentError).toMatch(expectedCopy as RegExp);
        // The refusal is terminal: no second request, no silent demo results.
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(useBoardStore.getState().cards).toEqual([]);
      },
    );

    it('a demo request carries no key even when one is configured', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => response,
      });
      const client = createAgentClient(
        { mode: 'demo', agentAccessKey: PITCH_KEY },
        mockFetch as unknown as typeof fetch,
      );

      await useBoardStore.getState().submitSearch('weekend markets', client);

      expect(JSON.parse(mockFetch.mock.calls[0][1].body).agent_access_key).toBeUndefined();
    });

    it('demo mode reaches the server instead of substituting the bundled fixture', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ...response, matches: response.matches.slice(0, 1) }),
      });
      useBoardStore.setState({ dataSourceMode: 'mock' });

      await useBoardStore
        .getState()
        .submitSearch('weekend markets', createAgentClient({ mode: 'demo' }, mockFetch as unknown as typeof fetch));

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(useBoardStore.getState().cards).toHaveLength(1);
    });

    it('a refusal on the FIRST query is still not downgraded to the fixture', async () => {
      // The store used to fall back to the bundled fixture whenever the initial
      // query failed, which silently turned a rejected live request into demo
      // results — the one outcome the gate exists to prevent.
      const mockFetch = deniedFetch(403, 'invalid_key');
      const client = createAgentClient(
        { mode: 'live', agentAccessKey: 'whatever' },
        mockFetch as unknown as typeof fetch,
      );

      await useBoardStore.getState().loadAgentResponse({ query: INITIAL_ACTIVITY_QUERY, mode: 'live' }, client);

      expect(useBoardStore.getState().agentStatus).toBe('error');
      expect(useBoardStore.getState().agentError).toMatch(/not recognised/i);
      expect(useBoardStore.getState().cards).toEqual([]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('a mid-pitch query with no server falls back to the fixture matcher', async () => {
      // The opposite direction: the fixture is the no-server fallback, so it must
      // not be reserved for the first query. And it must answer with the local
      // matcher (issue #128), not the one canned response — otherwise a judge
      // searching mid-pitch offline would get the same three cards as the pitch
      // opener regardless of what they asked.
      const unreachable = createAgentClient({ mode: 'demo' }, (() => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch);

      await useBoardStore
        .getState()
        .submitSearch(
          'Find activities similar to Badminton Court Booking in Central & Western: sports, badminton, indoor',
          unreachable,
        );

      const cards = useBoardStore.getState().cards;
      expect(useBoardStore.getState().agentStatus).toBe('results');
      expect(cards.length).toBeGreaterThan(0);
      // Not the canned initial-query response.
      expect(cards[0].activity.id).not.toBe('heritage-discovery-centre-guided-tour');
      // Actually relevant to the query — this is #128's matcher, not a stub.
      expect(
        cards.some((m) =>
          ['sports', 'badminton', 'indoor', 'squash'].includes(
            m.activity.tags.find((t) => ['sports', 'badminton', 'indoor', 'squash'].includes(t)) ?? '',
          ),
        ),
      ).toBe(true);
    });
  });

  it('handles server error response cleanly and sets error state', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    const client = createAgentClient({ mode: 'demo' }, mockFetch as unknown as typeof fetch);

    await useBoardStore.getState().submitSearch('bad query', client);

    expect(useBoardStore.getState().agentStatus).toBe('error');
    expect(useBoardStore.getState().agentError).toContain('500');
  });

  it('supports fixture client with zero network calls', async () => {
    const mockFetch = vi.fn();
    const client = createAgentClient({ transport: 'fixture' }, mockFetch as unknown as typeof fetch);

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
      { mode: 'demo' },
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
      { mode: 'demo' },
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
