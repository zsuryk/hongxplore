import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import agentResponse from '../../docs/examples/agent-response.json';
import { ActivityCard } from './ActivityCard';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { activityCardCtaLabel } from './copy';
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

  it('renders a tappable source CTA naming the source organisation', () => {
    // Ported from #112. The CTA replaces a bare inline `Source: <name>` link, so it has to be a
    // real control: it links the booking page, names who to visit, and stops pointerdown so that
    // pressing it cannot start a card drag — the whole card is a drag handle.
    const markup = renderToStaticMarkup(<ActivityCard match={response.matches[0]} />);

    expect(markup).toContain('class="btn btn--sm activity-card__cta"');
    expect(markup).toContain(`href="${response.matches[0].activity.url}"`);
    expect(markup).toContain(activityCardCtaLabel(response.matches[0].activity.source.name));
    expect(markup).toContain('rel="noreferrer"');
    expect(markup).toContain('target="_blank"');
  });

  it('stops pointerdown on the source CTA so pressing it does not start a drag', () => {
    // `renderToStaticMarkup` does not emit event handlers, so this cannot be asserted on rendered
    // output. Asserting against the source is the honest alternative, and there is precedent —
    // `dragProxy.test.tsx` reads `card.css` the same way. It matters because the whole card is a
    // drag handle: without the stop, pressing the one control every user will try starts a drag.
    const src = readFileSync(join(import.meta.dirname, 'ActivityCard.tsx'), 'utf8');
    const cta = src.slice(src.indexOf('activity-card__cta'));

    expect(cta).toContain('onPointerDown');
    expect(cta).toContain('stopPropagation');
  });

  it('omits the source CTA from the compact variant, matching the previous source row', () => {
    // The old footer guarded the source row with `variant !== 'compact'` so the compact card did
    // not blow out vertically. The CTA inherits that guard.
    const markup = renderToStaticMarkup(<ActivityCard match={response.matches[0]} variant="compact" />);

    expect(markup).not.toContain('activity-card__cta');
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
});
