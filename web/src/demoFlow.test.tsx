import { beforeEach, describe, expect, it } from 'vitest';
import { createAgentClient } from './api/client';
import { TIMELINE_SLOTS } from './copy';
import { useBoardStore } from './state/boardStore';

describe('End-to-end DEMO_MODE pitch path flow', () => {
  beforeEach(() => {
    useBoardStore.setState({
      agentError: null,
      agentLog: [],
      agentStatus: 'idle',
      cards: [],
      dataSourceMode: 'mock',
      discardedCards: [],
      selectedFreeSlotIds: [],
      timelineSlots: TIMELINE_SLOTS.map((slot) => ({ ...slot, activityId: null })),
    });
  });

  it('completes the entire pitch path: query -> seed cards -> timeline docking -> discard -> find similar', async () => {
    // 1. Initial empty state
    expect(useBoardStore.getState().cards).toHaveLength(0);
    expect(useBoardStore.getState().timelineSlots.every((s) => s.activityId === null)).toBe(true);

    // 2. Select availability slot
    useBoardStore.getState().toggleFreeSlot('saturday-afternoon');
    expect(useBoardStore.getState().selectedFreeSlotIds).toContain('saturday-afternoon');

    // 3. Submit search using zero-network fixture client (DEMO_MODE)
    const client = createAgentClient('fixture');
    await useBoardStore
      .getState()
      .submitSearch('free saturday afternoon, something cultural in Kowloon, English friendly', client);

    const stateAfterSearch = useBoardStore.getState();
    expect(stateAfterSearch.agentStatus).toBe('results');
    expect(stateAfterSearch.cards.length).toBeGreaterThan(0);
    expect(stateAfterSearch.agentLog.length).toBeGreaterThan(0);

    const card1 = stateAfterSearch.cards[0];
    const card2 = stateAfterSearch.cards[1];
    expect(card1.activity.id).toBeDefined();
    expect(card1.match_rationale).toBeTruthy();

    // 4. Dock card1 to Saturday afternoon slot
    const dockResult1 = useBoardStore.getState().dockCard(card1.activity.id, 'saturday-afternoon');
    expect(dockResult1).toBe(true);

    const satSlot = useBoardStore.getState().timelineSlots.find((s) => s.id === 'saturday-afternoon');
    expect(satSlot?.activityId).toBe(card1.activity.id);

    // 5. Collision rejection: docking card2 into the occupied Saturday afternoon slot is rejected
    const dockConflict = useBoardStore.getState().dockCard(card2.activity.id, 'saturday-afternoon');
    expect(dockConflict).toBe(false);
    expect(useBoardStore.getState().timelineSlots.find((s) => s.id === 'saturday-afternoon')?.activityId).toBe(
      card1.activity.id,
    );

    // 6. Dock card2 into Sunday afternoon
    const dockResult2 = useBoardStore.getState().dockCard(card2.activity.id, 'sunday-afternoon');
    expect(dockResult2).toBe(true);
    expect(useBoardStore.getState().timelineSlots.find((s) => s.id === 'sunday-afternoon')?.activityId).toBe(
      card2.activity.id,
    );

    // 7. Undock card1 from Saturday afternoon
    useBoardStore.getState().undockCard('saturday-afternoon');
    expect(useBoardStore.getState().timelineSlots.find((s) => s.id === 'saturday-afternoon')?.activityId).toBeNull();

    // 8. Discard card3 to the discard bin
    const card3 = stateAfterSearch.cards[2];
    useBoardStore.getState().discardCard(card3.activity.id);
    expect(useBoardStore.getState().cards.some((c) => c.activity.id === card3.activity.id)).toBe(false);
    expect(useBoardStore.getState().discardedCards.some((c) => c.activity.id === card3.activity.id)).toBe(true);

    // 9. Find similar for card1 in mock mode (adds new cards to the board)
    const cardCountBefore = useBoardStore.getState().cards.length;
    const findSimilarResult = await useBoardStore.getState().findSimilar(card1, client);
    expect(findSimilarResult).toBe(true);
    expect(useBoardStore.getState().cards.length).toBeGreaterThan(cardCountBefore);
    expect(useBoardStore.getState().lastMatchCount).toBeGreaterThan(0);
  });
});
