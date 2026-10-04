import { beforeEach, describe, expect, it, vi } from 'vitest';
import agentResponse from '../../docs/examples/agent-response.json';
import { createAgentClient } from './api/client';
import type { components } from './api/schema';
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
    expect(callBody.free_slots[0].start).toContain('2026-10-10');

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
});
