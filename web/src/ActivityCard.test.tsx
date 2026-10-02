import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import agentResponse from '../../docs/examples/agent-response.json';
import { ActivityCard } from './ActivityCard';
import type { components } from './api/schema';

const response = agentResponse as components['schemas']['AgentResponse'];

describe('ActivityCard', () => {
  it('renders the Activity card anatomy from the shared fixture', () => {
    const markup = renderToStaticMarkup(<ActivityCard match={response.matches[0]} />);

    expect(markup).toContain('Hong Kong Heritage Discovery Centre guided tour');
    expect(markup).toContain('香港歷史博物館 導賞團');
    expect(markup).toContain('Yau Tsim Mong');
    expect(markup).toContain('Hong Kong Heritage Discovery Centre');
    expect(markup).toContain('Free, in Tsim Sha Tsui');
    expect(markup).toContain('activity-card--spawning');
  });

  it('renders the discard animation state', () => {
    const markup = renderToStaticMarkup(<ActivityCard match={response.matches[1]} state="discarding" />);

    expect(markup).toContain('activity-card--discarding');
  });
});
