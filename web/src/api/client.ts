import seedActivitiesData from '../../../data/activities.json';
import fixtureResponse from '../../../docs/examples/agent-response.json';
import { INITIAL_ACTIVITY_QUERY } from '../copy';
import type { components } from './schema';

export type AgentClientMode = 'fixture' | 'live';
export type AgentRequest = components['schemas']['AgentRequest'];
export type AgentResponse = components['schemas']['AgentResponse'];
export type Activity = components['schemas']['Activity'];
export type MatchedActivity = components['schemas']['MatchedActivity'];

export type AgentClient = {
  requestAgent(request: AgentRequest): Promise<AgentResponse>;
};

type Fetch = typeof fetch;

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

export function createAgentClient(mode: AgentClientMode = 'live', fetchImplementation: Fetch = fetch): AgentClient {
  return {
    async requestAgent(request) {
      if (mode === 'fixture') {
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

      const response = await fetchImplementation('/api/agent', {
        body: JSON.stringify(request),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error(`Agent request failed with status ${response.status}`);
      }

      return (await response.json()) as AgentResponse;
    },
  };
}

export const fixtureAgentClient = createAgentClient('fixture');
export const liveAgentClient = createAgentClient('live');
export const defaultAgentClient = liveAgentClient;
