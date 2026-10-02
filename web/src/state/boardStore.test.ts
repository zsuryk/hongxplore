import { beforeEach, describe, expect, it, vi } from 'vitest';
import agentResponse from '../../../docs/examples/agent-response.json';
import type { AgentClient } from '../api/client';
import type { components } from '../api/schema';
import { useBoardStore } from './boardStore';

const response = agentResponse as components['schemas']['AgentResponse'];

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

    await useBoardStore.getState().findSimilar(card, client);

    expect(requestAgent).toHaveBeenCalledWith({
      query: expect.stringContaining('Hong Kong Heritage Discovery Centre guided tour'),
    });
    expect(requestAgent).toHaveBeenCalledWith({
      query: expect.stringContaining('Yau Tsim Mong'),
    });
    expect(useBoardStore.getState().cards).toHaveLength(response.matches.length);
  });
});
