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

  it('renders the find similar action when provided', () => {
    const markup = renderToStaticMarkup(<ActivityCard match={response.matches[0]} onFindSimilar={() => undefined} />);

    expect(markup).toContain('Find similar');
  });

  it('renders a compact docked view without vertical blowout', () => {
    const markup = renderToStaticMarkup(<ActivityCard match={response.matches[0]} size="docked" />);

    expect(markup).toContain('activity-card--docked');
    expect(markup).toContain('Hong Kong Heritage Discovery Centre guided tour');
    // Docked mode omits rationale, source link, and secondary title to prevent vertical expansion
    expect(markup).not.toContain('Free, in Tsim Sha Tsui');
    expect(markup).not.toContain('香港歷史博物館 導賞團');
    expect(markup).not.toContain('Source:');
  });

  it('renders compact variant with date chip badge', () => {
    const markup = renderToStaticMarkup(<ActivityCard match={response.matches[0]} variant="compact" />);

    expect(markup).toContain('activity-card--compact');
    expect(markup).toContain('activity-card__compact-badge');
  });

  it('renders wide and tall variants with their respective CSS variant classes', () => {
    const wideMarkup = renderToStaticMarkup(<ActivityCard match={response.matches[0]} variant="wide" />);
    const tallMarkup = renderToStaticMarkup(<ActivityCard match={response.matches[0]} variant="tall" />);

    expect(wideMarkup).toContain('activity-card--wide');
    expect(tallMarkup).toContain('activity-card--tall');
  });

  it('renders consistent time badges across card variants', () => {
    const standardMarkup = renderToStaticMarkup(<ActivityCard match={response.matches[0]} />);
    const dockedMarkup = renderToStaticMarkup(<ActivityCard match={response.matches[0]} size="docked" />);

    expect(standardMarkup).toContain('activity-card__time-badge');
    expect(dockedMarkup).toContain('activity-card__time-badge');
    expect(standardMarkup).toContain('Sat, 3 Oct, 2:00 pm');
  });

  it('renders the recent search highlight glow class when isRecent is true', () => {
    const glowingMarkup = renderToStaticMarkup(<ActivityCard isRecent match={response.matches[0]} />);
    const normalMarkup = renderToStaticMarkup(<ActivityCard isRecent={false} match={response.matches[0]} />);

    expect(glowingMarkup).toContain('activity-card--recent');
    expect(normalMarkup).not.toContain('activity-card--recent');
  });

  it('accurately badges activity languages', () => {
    // English activity
    const enMarkup = renderToStaticMarkup(<ActivityCard match={response.matches[2]} />);
    expect(enMarkup).toContain('English');

    // Chinese activity with English available tag
    const enAvailMarkup = renderToStaticMarkup(<ActivityCard match={response.matches[0]} />);
    expect(enAvailMarkup).toContain('English Available');

    // Authentic local Chinese activity
    const zhMarkup = renderToStaticMarkup(<ActivityCard match={response.matches[1]} />);
    expect(zhMarkup).toContain('Chinese');
  });
});
