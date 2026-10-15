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

  it('provides accessible language badge attributes and card label with language', () => {
    const markup = renderToStaticMarkup(<ActivityCard match={response.matches[0]} />);

    // Language badge has title, tabindex, and aria-label for accessibility & overflow inspectability
    expect(markup).toContain('title="Language: English Available"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('aria-label="Language: English Available"');

    // Card outer article contains language in accessible label
    expect(markup).toContain('(Language: English Available)');
  });

  it('renders both short and long rationales fully across card variants', () => {
    const shortMatch = {
      ...response.matches[0],
      match_rationale: 'Quick 2-line match.',
    };
    const longMatch = {
      ...response.matches[0],
      match_rationale:
        'A comprehensive 6-line rationale explaining why this activity is an outstanding choice for weekend discovery, offering rich cultural context, historic artifacts, and walking convenience in Tsim Sha Tsui.',
    };

    const shortMarkup = renderToStaticMarkup(<ActivityCard match={shortMatch} variant="compact" />);
    const longMarkup = renderToStaticMarkup(<ActivityCard match={longMatch} variant="compact" />);

    expect(shortMarkup).toContain('Quick 2-line match.');
    expect(longMarkup).toContain(
      'A comprehensive 6-line rationale explaining why this activity is an outstanding choice',
    );
  });

  describe('three-state pricing', () => {
    it('renders "Free" price badge when is_free is true', () => {
      const markup = renderToStaticMarkup(<ActivityCard match={response.matches[0]} />);

      expect(markup).toContain('activity-card__price-badge');
      expect(markup).toContain('Free');
    });

    it('renders formatted price badge with currency and parsed amount when priced', () => {
      const markup = renderToStaticMarkup(<ActivityCard match={response.matches[2]} />);

      expect(markup).toContain('activity-card__price-badge');
      expect(markup).toContain('HKD 59');
    });

    it('omits price row entirely when price is absent (never defaults to free)', () => {
      const markup = renderToStaticMarkup(<ActivityCard match={response.matches[1]} />);

      expect(markup).not.toContain('activity-card__price-badge');
      // match[1] does not contain "Free" anywhere
      expect(markup).not.toContain('Free');
    });
  });

  describe('freshness timestamp in HKT', () => {
    it('renders listed_at date formatted in HKT when present', () => {
      const markup = renderToStaticMarkup(<ActivityCard match={response.matches[0]} />);

      expect(markup).toContain('activity-card__freshness');
      expect(markup).toContain('Listed 28 Sept 2026');
    });

    it('omits freshness timestamp when listed_at is absent', () => {
      const markup = renderToStaticMarkup(<ActivityCard match={response.matches[1]} />);

      expect(markup).not.toContain('activity-card__freshness');
      expect(markup).not.toContain('Listed');
    });
  });

  describe('district and source CTA', () => {
    it('surfaces the district visibly in a district badge on the card face', () => {
      const markup = renderToStaticMarkup(<ActivityCard match={response.matches[0]} />);

      expect(markup).toContain('activity-card__district-badge');
      expect(markup).toContain('Yau Tsim Mong');
    });

    it('renders visible booking CTA linking to activity url with source organization name and dynamic truncation attributes', () => {
      const markup = renderToStaticMarkup(<ActivityCard match={response.matches[0]} />);

      expect(markup).toContain('activity-card__cta');
      expect(markup).toContain('activity-card__cta-text');
      expect(markup).toContain('href="https://www.heritagemuseum.gov.hk/"');
      expect(markup).toContain('title="Visit Hong Kong Heritage Discovery Centre"');
      expect(markup).toContain('aria-label="Visit Hong Kong Heritage Discovery Centre"');
      expect(markup).toContain('Visit Hong Kong Heritage Discovery Centre');
    });

    it('promotes original Cantonese title without expanding even in compact variant', () => {
      const markup = renderToStaticMarkup(<ActivityCard match={response.matches[0]} variant="compact" />);

      expect(markup).toContain('香港歷史博物館 導賞團');
    });
  });
});
