import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import agentResponse from '../../docs/examples/agent-response.json';
import { ActivityCard } from './ActivityCard';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACTIVITY_CARD_ROW_LISTED_LABEL,
  ACTIVITY_CARD_ROW_PRICE_LABEL,
  activityCardCtaLabel,
  activityCardListedLabel,
  activityCardPriceLabel,
} from './copy';
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

  /**
   * The four describes below were contributed by #112 against the pre-Blue-Hour card, where price,
   * freshness and district each rendered as their own inline badge (`--price-badge`, `--freshness`,
   * `--district-badge`). #111 replaced those with ruled data rows sharing one label gutter, so the
   * class names moved. **The behaviour #112 asked for is unchanged and still asserted here** — only
   * the selector names were re-pointed at the element that now carries each value. Deleting these
   * because the class names moved would throw away the review trail for the original intent.
   */
  describe('three-state pricing', () => {
    it('renders "Free" price when the activity is free', () => {
      const markup = renderToStaticMarkup(<ActivityCard match={response.matches[0]} />);

      expect(markup).toContain(ACTIVITY_CARD_ROW_PRICE_LABEL);
      expect(markup).toContain('Free');
    });

    it('renders formatted price with currency and amount when priced', () => {
      const markup = renderToStaticMarkup(<ActivityCard match={response.matches[2]} />);

      expect(markup).toContain(ACTIVITY_CARD_ROW_PRICE_LABEL);
      expect(markup).toContain('59.00 HKD');
    });

    it('never renders an absent price as "Free"', () => {
      // CONTEXT.md: an unpriced activity is "not listed", never silently free. #112 asserted this
      // by absence of its badge class; #111 keeps the guarantee but labels it, which is stronger —
      // the card now says so outright instead of merely omitting it.
      const markup = renderToStaticMarkup(<ActivityCard match={response.matches[1]} />);

      expect(markup).toContain(activityCardPriceLabel(response.matches[1].activity.price));
      expect(markup).not.toMatch(/>\s*Free\s*</);
    });
  });

  describe('freshness timestamp in HKT', () => {
    it('renders listed_at in HKT when present', () => {
      const markup = renderToStaticMarkup(<ActivityCard match={response.matches[0]} />);

      expect(markup).toContain(ACTIVITY_CARD_ROW_LISTED_LABEL);
      expect(markup).toContain(activityCardListedLabel(response.matches[0].activity.listed_at));
      // 2026-09-28T06:00Z is 14:00 on 28 Sept in Hong Kong, so the row must not show the UTC date.
      expect(markup).toContain('28 Sept');
    });

    it('says so when listed_at is absent rather than omitting the row', () => {
      const markup = renderToStaticMarkup(<ActivityCard match={response.matches[1]} />);

      expect(markup).toContain(ACTIVITY_CARD_ROW_LISTED_LABEL);
      expect(markup).toContain(activityCardListedLabel(response.matches[1].activity.listed_at));
    });
  });
});

describe('district and source CTA', () => {
  it('surfaces the district visibly in the header plate', () => {
    const markup = renderToStaticMarkup(<ActivityCard match={response.matches[0]} />);

    // #112 asserted an `--district-badge` element; #111 moved the district into the header
    // plate's tracked-caps label. Same requirement, current home.
    expect(markup).toContain('activity-card__district');
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

  it('shows the original Chinese title alongside the translated title', () => {
    // #112 asked for this to be promoted *without* expanding or hovering, and specifically asked
    // for it even in the compact variant. On the Blue Hour card the compact variant still
    // suppresses it — it is the one place the compact card's height budget genuinely cannot carry
    // a second title line. Asserted here as current behaviour; widening compact to match is a
    // design decision, not a merge conflict resolution.
    const standard = renderToStaticMarkup(<ActivityCard match={response.matches[0]} />);
    expect(standard).toContain('香港歷史博物館 導賞團');
    expect(standard).not.toMatch(/original-title[^>]*>\s*<\/p>/);

    const compact = renderToStaticMarkup(<ActivityCard match={response.matches[0]} variant="compact" />);
    expect(compact).not.toContain('activity-card__original-title');
  });

  /**
   * Cover image — ported from #118 (kORNkin).
   *
   * One assertion is deliberately *changed* rather than ported: #118 asserted
   * `alt="Cover image for <title>"`. On the Blue Hour card that makes a screen reader announce the
   * activity title twice — once as the `<article>`'s accessible name, once as the image — so the
   * cover is `alt=""` + `aria-hidden` instead. What #118 cared about (the image must not become a
   * second, redundant announcement) is still asserted; only its expression changed, and the reason
   * is recorded here rather than left as a silent divergence.
   */
  describe('cover image', () => {
    const withImage = (image: string | null) => ({
      ...response.matches[0],
      activity: { ...response.matches[0].activity, image },
    });

    it('renders a full-bleed cover when the activity has an image', () => {
      const markup = renderToStaticMarkup(<ActivityCard match={withImage('https://example.test/a.jpg')} />);

      expect(markup).toContain('activity-card__cover-wrap');
      expect(markup).toContain('src="https://example.test/a.jpg"');
      expect(markup).toContain('loading="lazy"');
      expect(markup).toContain('decoding="async"');
      expect(markup).toContain('draggable="false"');
      // Decorative: the activity title is already the card's accessible name.
      expect(markup).toContain('alt=""');
      expect(markup).toContain('aria-hidden="true"');
    });

    it('places the cover before the header plate so the plate keeps its own band', () => {
      // `index` is required for the serial plate to render at all, which is the point: the plate is
      // optional metadata, so asserting "the plate survived" needs a card that actually has one.
      const markup = renderToStaticMarkup(<ActivityCard index={2} match={withImage('https://example.test/a.jpg')} />);

      expect(markup.indexOf('activity-card__cover-wrap')).toBeLessThan(markup.indexOf('activity-card__head'));
      // The plate must survive the image — it carries the serial, district and departure time.
      expect(markup).toContain('activity-card__plate');
      expect(markup).toContain('activity-card__district');
    });

    it('omits the cover when the activity has no image', () => {
      // The common case with current seed data, so the card must render exactly as it did before
      // this feature existed.
      const markup = renderToStaticMarkup(<ActivityCard match={withImage(null)} />);

      expect(markup).not.toContain('activity-card__cover-wrap');
      expect(markup).toContain('activity-card__head');
    });

    it('omits the cover in docked mode so the timeline slot cannot blow out vertically', () => {
      const markup = renderToStaticMarkup(
        <ActivityCard match={withImage('https://example.test/a.jpg')} size="docked" />,
      );

      expect(markup).toContain('activity-card--docked');
      expect(markup).not.toContain('activity-card__cover-wrap');
    });

    it('renders the cover across every canvas variant', () => {
      for (const variant of ['compact', 'wide', 'tall'] as const) {
        const markup = renderToStaticMarkup(
          <ActivityCard match={withImage('https://example.test/a.jpg')} variant={variant} />,
        );
        expect(markup).toContain(`activity-card--${variant}`);
        expect(markup).toContain('activity-card__cover-wrap');
      }
    });
  });
});
