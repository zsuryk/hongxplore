import seedActivitiesData from '../../../data/activities.json';
import fixtureResponse from '../../../docs/examples/agent-response.json';
import { INITIAL_ACTIVITY_QUERY } from '../copy';
import type { components } from './schema';

type Schema = components['schemas'];

export type AgentRequest = Schema['AgentRequest'];
export type AgentResponse = Schema['AgentResponse'];
export type Activity = Schema['Activity'];
export type MatchedActivity = Schema['MatchedActivity'];
/** Which world the caller is asking about. `live` is gated by an agent access key. */
export type AgentMode = Schema['AgentRequest']['mode'];
export type AccessDeniedReason = Schema['AgentAccessError']['reason'];

export type AgentClient = {
  requestAgent(request: AgentRequest): Promise<AgentResponse>;
};

/**
 * How a client talks to the agent, and what it is allowed to ask for.
 *
 * The two axes are deliberately separate, because they answer different
 * questions. `transport` is *where the answer comes from*; `mode` is *what kind
 * of answer it may be*.
 *
 * - `network` + `demo` — the normal path. The server is the source of truth for
 *   the dataset, so demo mode is asked of it rather than assembled in the
 *   browser (issue #83).
 * - `fixture` — the bundle and the local matcher in this file, with no network
 *   at all. This is the no-server fallback: it is what keeps the demo presentable
 *   when the API is down, and what makes "find similar" return relevant cards
 *   rather than the one canned response (issue #128).
 */
export type AgentClientOptions = {
  transport?: 'network' | 'fixture';
  mode?: AgentMode;
  /** Shared pitch key. Sent only with `mode: 'live'`. */
  agentAccessKey?: string;
};

type Fetch = typeof fetch;

/**
 * The server refused a live request.
 *
 * It carries the server's reason code so the UI can say the right thing —
 * "paste the key" is useless advice for a key that was entered but not
 * recognised, and both are useless for an instance that cannot do live at all.
 * It is thrown, never caught-and-downgraded: silently serving demo data to a
 * judge who thinks they are seeing live results is the failure this gate exists
 * to prevent.
 */
export class AgentAccessDeniedError extends Error {
  readonly reason: AccessDeniedReason;

  constructor(reason: AccessDeniedReason, message?: string) {
    super(message ?? `Live mode refused: ${reason}`);
    this.name = 'AgentAccessDeniedError';
    this.reason = reason;
  }
}

const fixtureAgentResponse = fixtureResponse as AgentResponse;
const seedActivities = seedActivitiesData as unknown as Activity[];

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'and',
  'or',
  'with',
  'find',
  'activities',
  'similar',
  'something',
  'any',
  'is',
  'are',
  'some',
  'my',
]);

function matchMockActivities(query: string, limit: number = 3): MatchedActivity[] {
  const queryLower = query.toLowerCase();

  const seedActivity = seedActivities.find((act) => {
    const title = act.title_en ?? act.title;
    return queryLower.includes(title.toLowerCase()) || queryLower.includes(act.title.toLowerCase());
  });

  const tokens = queryLower
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));

  const scored: { activity: Activity; score: number; matchedTags: string[] }[] = [];

  for (const act of seedActivities) {
    if (seedActivity && act.id === seedActivity.id) {
      continue;
    }

    let score = 0;
    const districtLower = act.location.district.toLowerCase();
    const actTags = act.tags.map((t) => t.toLowerCase());
    const matchedTags: string[] = [];

    // District match: high weight
    if (queryLower.includes(districtLower)) {
      score += 30;
    }

    // Tag matches
    for (const tag of actTags) {
      if (tokens.includes(tag) || queryLower.includes(tag)) {
        score += 15;
        matchedTags.push(tag);
      }
    }

    // Keyword matches in title / venue
    const searchable = `${act.title} ${act.title_en ?? ''} ${act.location.venue ?? ''}`.toLowerCase();
    for (const token of tokens) {
      if (searchable.includes(token)) {
        score += 5;
      }
    }

    if (score > 0) {
      scored.push({ activity: act, score, matchedTags });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const selected =
    scored.length > 0
      ? scored.slice(0, limit)
      : seedActivities.slice(0, limit).map((act) => ({ activity: act, score: 0, matchedTags: [] }));

  return selected.map((item) => {
    const act = item.activity;
    const rationale = `Similar activity in ${act.location.district}${item.matchedTags.length ? ` matching ${item.matchedTags.slice(0, 2).join(', ')}` : ''}.`;
    return {
      activity: act,
      match_rationale: rationale,
    };
  });
}

export function createAgentClient(options: AgentClientOptions = {}, fetchImplementation: Fetch = fetch): AgentClient {
  const { transport = 'network', mode = 'demo', agentAccessKey } = options;

  return {
    async requestAgent(request) {
      if (transport === 'fixture') {
        if (request.query.trim() === INITIAL_ACTIVITY_QUERY.trim()) {
          return fixtureAgentResponse;
        }

        const matches = matchMockActivities(request.query);
        return {
          log: [
            {
              level: 'info',
              message: `Found ${matches.length} similar activities for "${request.query}".`,
              ts: new Date().toISOString(),
            },
          ],
          matches,
          query: request.query,
          status: 'ok',
        };
      }

      // The key travels only with a live request, so a demo request can never
      // leak it into a request log or a proxy trace.
      const payload: AgentRequest = {
        ...request,
        mode,
        ...(mode === 'live' && agentAccessKey ? { agent_access_key: agentAccessKey } : {}),
      };

      const response = await fetchImplementation('/api/agent', {
        body: JSON.stringify(payload),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });

      if (response.status === 401 || response.status === 403) {
        throw await accessDeniedFrom(response);
      }

      if (!response.ok) {
        throw new Error(`Agent request failed with status ${response.status}`);
      }

      return (await response.json()) as AgentResponse;
    },
  };
}

/** Read the server's `AgentAccessError` detail, tolerating a body that lacks it. */
async function accessDeniedFrom(response: Response): Promise<AgentAccessDeniedError> {
  // The status still carries the signal when the body does not: 401 means no
  // credential arrived, 403 means one arrived and was not accepted. Defaulting
  // both to `invalid_key` would tell someone who never entered a key to go
  // check the one they do not have.
  const fallbackReason: AccessDeniedReason = response.status === 401 ? 'missing_key' : 'invalid_key';
  const fallback = `Agent request refused with status ${response.status}`;

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return new AgentAccessDeniedError(fallbackReason, fallback);
  }

  const detail = (body as { detail?: { reason?: unknown; message?: unknown } }).detail;
  const reason = detail?.reason;
  const message = detail?.message;

  if (typeof reason !== 'string' || !isAccessDeniedReason(reason)) {
    return new AgentAccessDeniedError(fallbackReason, typeof message === 'string' ? message : fallback);
  }

  return new AgentAccessDeniedError(reason, typeof message === 'string' ? message : fallback);
}

function isAccessDeniedReason(value: string): value is AccessDeniedReason {
  return value === 'missing_key' || value === 'invalid_key' || value === 'demo_only_instance';
}

/** Asks the server for demo data. The server is the source of truth for the dataset. */
export const demoAgentClient = createAgentClient({ mode: 'demo' });
/** No network at all: the bundle for the first query, the local matcher after. */
export const fixtureAgentClient = createAgentClient({ transport: 'fixture' });
/**
 * What the app uses with no key entered: a real request to the server, asking
 * for demo data.
 *
 * Named for the transport, not the mode. There is deliberately no live client
 * here yet, because nothing in the UI collects an agent access key — shipping
 * one before the key-entry design is settled would be a landmine for whoever
 * builds it. Whoever does exports
 * `createAgentClient({ mode: 'live', agentAccessKey })`.
 */
export const defaultAgentClient = demoAgentClient;
