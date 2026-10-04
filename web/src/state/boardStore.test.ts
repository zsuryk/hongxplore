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
