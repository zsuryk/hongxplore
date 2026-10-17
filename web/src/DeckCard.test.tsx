import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import agentResponse from '../../docs/examples/agent-response.json';
import { DeckCard } from './DeckCard';
import type { components } from './api/schema';
import {
  DECK_MATCH_RATIONALE_LABEL,
  DECK_LOCATION_LABEL,
  DECK_SCHEDULE_LABEL,
  DECK_PRICE_LABEL,
  DECK_BOOKING_GUIDE_BADGE,
  activityCardPriceLabel,
} from './copy';

const response = agentResponse as components['schemas']['AgentResponse'];

describe('DeckCard', () => {
  it('renders rich expanded activity card anatomy', () => {
    const match = response.matches[0];
    const markup = renderToStaticMarkup(<DeckCard index={0} match={match} />);

    // Title & original
    expect(markup).toContain('Hong Kong Heritage Discovery Centre guided tour');
    expect(markup).toContain('香港歷史博物館 導賞團');
    expect(markup).toContain('01');

    // Rationale
    expect(markup).toContain(DECK_MATCH_RATIONALE_LABEL);
    expect(markup).toContain(match.match_rationale);

    // Location & price
    expect(markup).toContain(DECK_LOCATION_LABEL);
    expect(markup).toContain('Yau Tsim Mong');
    expect(markup).toContain(DECK_PRICE_LABEL);
    expect(markup).toContain(activityCardPriceLabel(match.activity.price));

    // Schedule
    expect(markup).toContain(DECK_SCHEDULE_LABEL);

    // Source CTA
    expect(markup).toContain(`href="${match.activity.url}"`);
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noreferrer"');
  });

  it('renders facility booking guide badge when tags indicate a guide', () => {
    const guideMatch: components['schemas']['MatchedActivity'] = {
      ...response.matches[0],
      activity: {
        ...response.matches[0].activity,
        tags: ['guide', 'facility-booking', 'lcsd'],
      },
    };

    const markup = renderToStaticMarkup(<DeckCard index={1} match={guideMatch} />);
    expect(markup).toContain(DECK_BOOKING_GUIDE_BADGE);
  });

  it('renders swipe feedback classes when swiping state is active', () => {
    const markup = renderToStaticMarkup(<DeckCard index={0} match={response.matches[0]} swipeDirection="left" />);
    expect(markup).toContain('deck-card--swiping-left');
  });
});
