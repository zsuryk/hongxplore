import { beforeEach, describe, expect, it } from 'vitest';
import { useBoardStore } from './boardStore';

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
});
