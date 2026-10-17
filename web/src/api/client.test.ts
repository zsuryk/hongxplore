import { describe, expect, it, vi } from 'vitest';
import agentResponse from '../../../docs/examples/agent-response.json';
import { formatAgentErrorMessage, INITIAL_ACTIVITY_QUERY, isServerUnreachable } from '../copy';
import { AgentAccessDeniedError, AgentRequestRejectedError, createAgentClient } from './client';
import type { components } from './schema';

const response = agentResponse as components['schemas']['AgentResponse'];
const PITCH_KEY = 'hx-pitch-key-2026';

describe('createAgentClient in fixture / mock mode', () => {
  it('returns default fixture matches for the initial query', async () => {
    const client = createAgentClient({ transport: 'fixture' });
    const response = await client.requestAgent({ query: INITIAL_ACTIVITY_QUERY, mode: 'demo' });

    expect(response.status).toBe('ok');
    expect(response.matches).toHaveLength(3);
    expect(response.matches[0].activity.id).toBe('heritage-discovery-centre-guided-tour');
  });

  it('returns relevant candidate cards from the seed catalog for find-similar queries', async () => {
    const client = createAgentClient({ transport: 'fixture' });
    const response = await client.requestAgent({
      query:
        'Find activities similar to Badminton Court Booking — Hong Kong Park Sports Centre in Central & Western: sports, badminton, indoor, lcsd, court-booking',
      mode: 'demo',
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
    const client = createAgentClient({ transport: 'fixture' });
    const queryA = 'Find activities similar to Badminton Court Booking in Central & Western: sports, badminton, indoor';
    const queryB =
      'Find activities similar to Sham Shui Po cultural walk in Sham Shui Po: culture, walking-tour, neighbourhood';

    const responseA = await client.requestAgent({ query: queryA, mode: 'demo' });
    const responseB = await client.requestAgent({ query: queryB, mode: 'demo' });

    expect(responseA.matches.length).toBeGreaterThan(0);
    expect(responseB.matches.length).toBeGreaterThan(0);

    const idsA = new Set(responseA.matches.map((m) => m.activity.id));
    const idsB = new Set(responseB.matches.map((m) => m.activity.id));

    // The sets of returned cards must be different
    const overlap = [...idsA].filter((id) => idsB.has(id));
    expect(overlap.length).toBeLessThan(responseA.matches.length);
  });
});

function okFetch() {
  return vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => response });
}

function deniedFetch(status: number, reason: string) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({ detail: { reason, message: `server says ${reason}` } }),
  });
}

function rejectedFetch(status: number, reason: string, headers: Record<string, string> = {}) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    headers: new Headers(headers),
    json: async () => ({ detail: { reason, message: `server says ${reason}` } }),
  });
}

function bodyOf(fetchMock: ReturnType<typeof vi.fn>) {
  return JSON.parse(fetchMock.mock.calls[0][1].body);
}

describe('agent access key on the wire (issue #83)', () => {
  it('a demo request asks the server for demo mode and sends no key', async () => {
    const fetchMock = okFetch();
    const client = createAgentClient({ mode: 'demo' }, fetchMock as unknown as typeof fetch);

    await client.requestAgent({ query: 'weekend markets', mode: 'demo' });

    expect(bodyOf(fetchMock).mode).toBe('demo');
    expect(bodyOf(fetchMock).agent_access_key).toBeUndefined();
  });

  it('a live request carries the pitch key', async () => {
    const fetchMock = okFetch();
    const client = createAgentClient({ mode: 'live', agentAccessKey: PITCH_KEY }, fetchMock as unknown as typeof fetch);

    await client.requestAgent({ query: 'weekend markets', mode: 'live' });

    expect(bodyOf(fetchMock).mode).toBe('live');
    expect(bodyOf(fetchMock).agent_access_key).toBe(PITCH_KEY);
  });

  it('a live request without a key is still sent, so the server can refuse it', async () => {
    const fetchMock = okFetch();
    const client = createAgentClient({ mode: 'live' }, fetchMock as unknown as typeof fetch);

    await client.requestAgent({ query: 'weekend markets', mode: 'live' });

    expect(bodyOf(fetchMock).mode).toBe('live');
    expect(bodyOf(fetchMock).agent_access_key).toBeUndefined();
  });

  it('the fixture transport never touches the network', async () => {
    const fetchMock = vi.fn();
    const client = createAgentClient({ transport: 'fixture' }, fetchMock as unknown as typeof fetch);

    await client.requestAgent({ query: 'weekend markets', mode: 'demo' });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the fixture transport ignores a requested key entirely', async () => {
    // Issue #83 made the bundle a no-server fallback; it must not become a
    // second path that carries the pitch key to somewhere local.
    const fetchMock = vi.fn();
    const client = createAgentClient(
      { transport: 'fixture', mode: 'live', agentAccessKey: PITCH_KEY },
      fetchMock as unknown as typeof fetch,
    );

    await client.requestAgent({ query: 'weekend markets', mode: 'live' });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the gate is surfaced, not swallowed (issue #83)', () => {
  it('a refused live request rejects rather than falling back to the fixture', async () => {
    const fetchMock = deniedFetch(401, 'missing_key');
    const client = createAgentClient({ mode: 'live', agentAccessKey: PITCH_KEY }, fetchMock as unknown as typeof fetch);

    await expect(client.requestAgent({ query: 'weekend markets', mode: 'live' })).rejects.toBeInstanceOf(
      AgentAccessDeniedError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, 'missing_key'],
    [403, 'invalid_key'],
    [403, 'demo_only_instance'],
  ])('reason %s/%s reaches the error', async (status, reason) => {
    const client = createAgentClient(
      { mode: 'live', agentAccessKey: PITCH_KEY },
      deniedFetch(status as number, reason as string) as unknown as typeof fetch,
    );

    await expect(client.requestAgent({ query: 'weekend markets', mode: 'live' })).rejects.toMatchObject({ reason });
  });

  it('an unparseable 401 still reads as a missing key, not a wrong one', async () => {
    // Without the status the body has no reason code, and defaulting to
    // `invalid_key` would tell someone with no key to check theirs.
    const client = createAgentClient(
      { mode: 'live' },
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }) as unknown as typeof fetch,
    );

    await expect(client.requestAgent({ query: 'weekend markets', mode: 'live' })).rejects.toMatchObject({
      reason: 'missing_key',
    });
  });

  it('friendly copy tells a missing key apart from a wrong one', () => {
    const missing = formatAgentErrorMessage(new AgentAccessDeniedError('missing_key'));
    const invalid = formatAgentErrorMessage(new AgentAccessDeniedError('invalid_key'));

    expect(missing).not.toBe(invalid);
    expect(missing).toMatch(/key/i);
    expect(invalid).toMatch(/not recognised|incorrect|check/i);
  });

  it('friendly copy covers the demo-only instance refusal', () => {
    expect(formatAgentErrorMessage(new AgentAccessDeniedError('demo_only_instance'))).toMatch(/demo mode/i);
  });

  it('an unexpected status still surfaces as a plain error', async () => {
    const client = createAgentClient({ mode: 'demo' }, deniedFetch(500, 'whatever') as unknown as typeof fetch);

    await expect(client.requestAgent({ query: 'weekend markets', mode: 'demo' })).rejects.toThrow('500');
  });
});

describe('a refusal with a reason reads as copy, not a raw status (issue #88)', () => {
  it.each([
    [429, 'rate_limited'],
    [413, 'request_too_large'],
    [413, 'query_too_long'],
    [413, 'too_many_free_slots'],
  ])('reason %s/%s reaches the error', async (status, reason) => {
    const client = createAgentClient({ mode: 'demo' }, rejectedFetch(status, reason) as unknown as typeof fetch);

    await expect(client.requestAgent({ query: 'weekend markets', mode: 'demo' })).rejects.toBeInstanceOf(
      AgentRequestRejectedError,
    );
    await expect(client.requestAgent({ query: 'weekend markets', mode: 'demo' })).rejects.toMatchObject({ reason });
  });

  it('a rate limit hands back when to come back', async () => {
    // The server sends Retry-After so a well-behaved client can wait instead of
    // hammering a limit it cannot see.
    const client = createAgentClient(
      { mode: 'demo' },
      rejectedFetch(429, 'rate_limited', { 'retry-after': '42' }) as unknown as typeof fetch,
    );

    await expect(client.requestAgent({ query: 'weekend markets', mode: 'demo' })).rejects.toMatchObject({
      retryAfterSeconds: 42,
    });
  });

  it('a refused request never falls back to the bundled fixture', async () => {
    // Serving seed cards to someone whose query was refused is how a judge ends
    // up looking at demo data believing it is live.
    const error = new AgentRequestRejectedError('rate_limited');

    expect(isServerUnreachable(error)).toBe(false);
    expect(formatAgentErrorMessage(error)).not.toMatch(/connection|unreachable/i);
  });

  it('friendly copy explains what to do about a rate limit', () => {
    const message = formatAgentErrorMessage(new AgentRequestRejectedError('rate_limited'));

    expect(message).toMatch(/few seconds|wait|again/i);
    expect(message).not.toMatch(/429/);
  });

  it('friendly copy tells an oversized request apart from a rate limit', () => {
    const tooLarge = formatAgentErrorMessage(new AgentRequestRejectedError('request_too_large'));
    const rateLimited = formatAgentErrorMessage(new AgentRequestRejectedError('rate_limited'));

    expect(tooLarge).not.toBe(rateLimited);
    expect(tooLarge).toMatch(/shorter|smaller|bigger/i);
  });

  it('an unrecognised reason still carries the server message through', async () => {
    // A server newer than this client may add a reason the copy table has never
    // heard of. Dropping the sentence would leave the user with nothing.
    const client = createAgentClient(
      { mode: 'demo' },
      rejectedFetch(429, 'quota_astronomically_exceeded') as unknown as typeof fetch,
    );

    await expect(client.requestAgent({ query: 'weekend markets', mode: 'demo' })).rejects.toThrow(
      'server says quota_astronomically_exceeded',
    );
  });
});
