import { describe, expect, it } from 'vitest';
import { INITIAL_ACTIVITY_QUERY } from '../copy';
import { createAgentClient } from './client';

describe('createAgentClient in fixture / mock mode', () => {
  it('returns default fixture matches for the initial query', async () => {
    const client = createAgentClient('fixture');
    const response = await client.requestAgent({ query: INITIAL_ACTIVITY_QUERY });

    expect(response.status).toBe('ok');
    expect(response.matches).toHaveLength(3);
    expect(response.matches[0].activity.id).toBe('heritage-discovery-centre-guided-tour');
  });

  it('returns relevant candidate cards from the seed catalog for find-similar queries', async () => {
    const client = createAgentClient('fixture');
    const response = await client.requestAgent({
      query:
        'Find activities similar to Badminton Court Booking — Hong Kong Park Sports Centre in Central & Western: sports, badminton, indoor, lcsd, court-booking',
    });

    expect(response.status).toBe('ok');
    expect(response.matches.length).toBeGreaterThan(0);
    // Should not return the default initial fixture or seed card
    expect(response.matches[0].activity.id).not.toBe('heritage-discovery-centre-guided-tour');
    expect(response.matches.some((m) => m.activity.id === 'act-001')).toBe(false);
    // Should match relevant tags or district
    expect(
      response.matches.some(
        (m) =>
          m.activity.location.district === 'Central & Western' ||
          m.activity.tags.some((t) => ['sports', 'badminton', 'indoor', 'squash'].includes(t)),
      ),
    ).toBe(true);
  });

  it('returns different cards for successive find-similar calls with different seed queries', async () => {
    const client = createAgentClient('fixture');
    const queryA = 'Find activities similar to Badminton Court Booking in Central & Western: sports, badminton, indoor';
    const queryB =
      'Find activities similar to Sham Shui Po cultural walk in Sham Shui Po: culture, walking-tour, neighbourhood';

    const responseA = await client.requestAgent({ query: queryA });
    const responseB = await client.requestAgent({ query: queryB });

    expect(responseA.matches.length).toBeGreaterThan(0);
    expect(responseB.matches.length).toBeGreaterThan(0);

    const idsA = new Set(responseA.matches.map((m) => m.activity.id));
    const idsB = new Set(responseB.matches.map((m) => m.activity.id));

    // The sets of returned cards must be different
    const overlap = [...idsA].filter((id) => idsB.has(id));
    expect(overlap.length).toBeLessThan(responseA.matches.length);
  });
});
