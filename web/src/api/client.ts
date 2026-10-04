import fixtureResponse from '../../../docs/examples/agent-response.json';
import type { components } from './schema';

export type AgentClientMode = 'fixture' | 'live';
export type AgentRequest = components['schemas']['AgentRequest'];
export type AgentResponse = components['schemas']['AgentResponse'];

export type AgentClient = {
  requestAgent(request: AgentRequest): Promise<AgentResponse>;
};

type Fetch = typeof fetch;

const fixtureAgentResponse = fixtureResponse as AgentResponse;

export function createAgentClient(mode: AgentClientMode = 'fixture', fetchImplementation: Fetch = fetch): AgentClient {
  return {
    async requestAgent(request) {
      if (mode === 'fixture') {
        return fixtureAgentResponse;
      }

      const response = await fetchImplementation('/api/agent', {
        body: JSON.stringify(request),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error(`Agent request failed with ${response.status}`);
      }

      return (await response.json()) as AgentResponse;
    },
  };
}

export const fixtureAgentClient = createAgentClient();
