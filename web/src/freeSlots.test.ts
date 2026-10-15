import { describe, expect, it } from 'vitest';
import { computeUpcomingWeekendDates, getUpcomingWeekendFreeSlots } from './copy';
import { useBoardStore } from './state/boardStore';
import type { AgentClient, AgentRequest } from './api/client';

describe('free slots live weekend derivation (#69)', () => {
  it('computes upcoming weekend dates for weekdays (Mon-Fri) in HKT', () => {
    // Thursday, Oct 15, 2026, 14:00 HKT (06:00 UTC)
    const thuRef = new Date('2026-10-15T06:00:00Z');
    const dates = computeUpcomingWeekendDates(thuRef);

    expect(dates.saturday).toBe('2026-10-17');
    expect(dates.sunday).toBe('2026-10-18');
  });

  it('derives chips for a Saturday reference date and excludes started periods', () => {
    // Saturday, Oct 17, 2026, 10:00 HKT (02:00 UTC)
    // Saturday morning starts at 09:00 HKT (01:00 UTC) -> has already started!
    // Saturday afternoon starts at 13:00 HKT (05:00 UTC) -> has NOT started.
    const satRef = new Date('2026-10-17T02:00:00Z');
    const slots = getUpcomingWeekendFreeSlots(satRef);

    // Sat morning is excluded because it already started
    expect(slots.some((s) => s.id === 'saturday-morning')).toBe(false);

    // Remaining slots must be present
    expect(slots.map((s) => s.id)).toEqual([
      'saturday-afternoon',
      'saturday-evening',
      'sunday-morning',
      'sunday-afternoon',
      'sunday-evening',
    ]);

    // All returned slots must be strictly in the future relative to satRef
    for (const slot of slots) {
      expect(new Date(slot.start).getTime()).toBeGreaterThan(satRef.getTime());
      expect(slot.start.startsWith('2026-10-17') || slot.start.startsWith('2026-10-18')).toBe(true);
    }
  });

  it('derives chips for a Sunday reference date and excludes all past periods', () => {
    // Sunday, Oct 18, 2026, 11:30 HKT (03:30 UTC)
    // Saturday slots are all in the past
    // Sunday morning (09:00-12:00 HKT) started at 01:00 UTC -> already started!
    // Sunday afternoon (13:00-18:00 HKT) starts at 05:00 UTC -> upcoming
    // Sunday evening (18:00-22:00 HKT) starts at 10:00 UTC -> upcoming
    const sunRef = new Date('2026-10-18T03:30:00Z');
    const slots = getUpcomingWeekendFreeSlots(sunRef);

    expect(slots.map((s) => s.id)).toEqual(['sunday-afternoon', 'sunday-evening']);

    // Past-date assertion: no chip ever names a period that has already started
    for (const slot of slots) {
      expect(new Date(slot.start).getTime()).toBeGreaterThan(sunRef.getTime());
      expect(slot.start).toContain('2026-10-18');
    }
  });

  it('past-date assertion: no returned chip ever has start <= reference time', () => {
    const testInstants = [
      new Date('2026-10-16T12:00:00Z'), // Friday 20:00 HKT
      new Date('2026-10-17T00:59:00Z'), // Saturday 08:59 HKT (1 min before morning slot)
      new Date('2026-10-17T05:01:00Z'), // Saturday 13:01 HKT (1 min after afternoon slot started)
      new Date('2026-10-17T11:00:00Z'), // Saturday 19:00 HKT (evening slot started)
      new Date('2026-10-18T01:30:00Z'), // Sunday 09:30 HKT
      new Date('2026-10-18T06:00:00Z'), // Sunday 14:00 HKT
    ];

    for (const instant of testInstants) {
      const chips = getUpcomingWeekendFreeSlots(instant);
      for (const chip of chips) {
        expect(new Date(chip.start).getTime()).toBeGreaterThan(instant.getTime());
      }
    }
  });

  it('rolls forward to next weekend on Monday or when all current weekend slots have started', () => {
    // Late Sunday night: Oct 18, 2026, 23:00 HKT (15:00 UTC) -> all slots of Oct 17-18 have started
    const sunLateRef = new Date('2026-10-18T15:00:00Z');
    const rolledSlots = getUpcomingWeekendFreeSlots(sunLateRef);

    // Must return upcoming weekend slots for next week (Oct 24 - 25)
    expect(rolledSlots).toHaveLength(6);
    expect(rolledSlots[0]?.start).toContain('2026-10-24');
    expect(rolledSlots[3]?.start).toContain('2026-10-25');

    // Monday morning: Oct 19, 2026, 09:00 HKT (01:00 UTC)
    const monRef = new Date('2026-10-19T01:00:00Z');
    const monSlots = getUpcomingWeekendFreeSlots(monRef);
    expect(monSlots).toHaveLength(6);
    expect(monSlots[0]?.start).toContain('2026-10-24');
    expect(monSlots[3]?.start).toContain('2026-10-25');
  });

  it('selected-chips-to-request mapping: selected chips are carried 1:1 into submitSearch payload', async () => {
    let capturedRequest: AgentRequest | null = null;
    const mockClient: AgentClient = {
      async requestAgent(request) {
        capturedRequest = request;
        return { status: 'ok', query: request.query, matches: [], log: [] };
      },
    };

    // Reference time: Thursday Oct 15, 2026
    const refTime = new Date('2026-10-15T06:00:00Z');
    const upcomingChips = getUpcomingWeekendFreeSlots(refTime);
    const morningChip = upcomingChips.find((c) => c.id === 'saturday-morning')!;
    const eveningChip = upcomingChips.find((c) => c.id === 'sunday-evening')!;

    useBoardStore.setState({
      selectedFreeSlotIds: ['saturday-morning', 'sunday-evening'],
    });

    await useBoardStore.getState().submitSearch('cultural walk', mockClient, { referenceTime: refTime });

    expect(capturedRequest).not.toBeNull();
    expect(capturedRequest!.query).toBe('cultural walk');
    expect(capturedRequest!.free_slots).toEqual([
      { start: morningChip.start, end: morningChip.end },
      { start: eveningChip.start, end: eveningChip.end },
    ]);
  });
});
