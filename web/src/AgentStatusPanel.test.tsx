import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import agentResponse from '../../docs/examples/agent-response.json';
import { AgentStatusPanel } from './AgentStatusPanel';
import type { components } from './api/schema';
import {
  AGENT_STATUS_ERROR,
  AGENT_STATUS_IDLE,
  AGENT_STATUS_SEARCHING,
  agentStatusResults,
  formatLogTimestamp,
} from './copy';

const response = agentResponse as components['schemas']['AgentResponse'];

describe('AgentStatusPanel', () => {
  it('renders idle status', () => {
    const markup = renderToStaticMarkup(<AgentStatusPanel status="idle" />);

    expect(markup).toContain(AGENT_STATUS_IDLE);
    expect(markup).toContain('agent-status-dot--idle');
  });

  it('renders searching status', () => {
    const markup = renderToStaticMarkup(<AgentStatusPanel status="searching" />);

    expect(markup).toContain(AGENT_STATUS_SEARCHING);
    expect(markup).toContain('agent-status-dot--searching');
  });

  it('renders results count', () => {
    const markup = renderToStaticMarkup(<AgentStatusPanel cards={response.matches} status="results" />);

    expect(markup).toContain(agentStatusResults(response.matches.length));
    expect(markup).toContain('agent-status-dot--results');
  });

  it('renders error state with copy', () => {
    const markup = renderToStaticMarkup(<AgentStatusPanel status="error" />);

    expect(markup).toContain(AGENT_STATUS_ERROR);
    expect(markup).toContain('agent-status-dot--error');
  });

  it('formats log timestamps in HKT', () => {
    const iso = '2026-10-04T06:00:00Z';
    const formatted = formatLogTimestamp(iso);
    expect(formatted).toBe('14:00:00');
  });
});
