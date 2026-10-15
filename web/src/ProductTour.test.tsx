import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  PRODUCT_TOUR_LABEL,
  TOUR_CARD_BODY,
  TOUR_CARD_TITLE,
  TOUR_FINISH_LABEL,
  TOUR_NEXT_LABEL,
  TOUR_PREV_LABEL,
  TOUR_SEARCH_BODY,
  TOUR_SEARCH_TITLE,
  TOUR_SKIP_LABEL,
  TOUR_TIMELINE_BODY,
  TOUR_TIMELINE_TITLE,
  TOUR_TOOLBAR_BODY,
  TOUR_TOOLBAR_TITLE,
} from './copy';
import { ProductTour } from './ProductTour';
import { TOUR_STEPS } from './tourSteps';

describe('ProductTour', () => {
  it('renders nothing when isOpen is false', () => {
    const markup = renderToStaticMarkup(<ProductTour isOpen={false} onClose={() => undefined} />);
    expect(markup).toBe('');
  });

  it('renders Step 1 (search bar) with accessible name, live region, and buttons on initial open', () => {
    const markup = renderToStaticMarkup(<ProductTour isOpen={true} onClose={() => undefined} />);

    expect(markup).toContain('class="product-tour"');
    expect(markup).toContain(`aria-label="${PRODUCT_TOUR_LABEL}"`);
    expect(markup).toContain('role="region"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain(TOUR_SEARCH_TITLE);
    expect(markup).toContain(TOUR_SEARCH_BODY);
    expect(markup).toContain('Step 1 of 4');
    expect(markup).toContain(TOUR_NEXT_LABEL);
    expect(markup).toContain(TOUR_SKIP_LABEL);
    // Back button should not be rendered on step 1
    expect(markup).not.toContain(TOUR_PREV_LABEL);
  });

  it('renders Step 2 (card step) with Back and Next buttons', () => {
    const markup = renderToStaticMarkup(<ProductTour initialStep={1} isOpen={true} onClose={() => undefined} />);

    expect(markup).toContain(TOUR_CARD_TITLE);
    expect(markup).toContain(TOUR_CARD_BODY);
    expect(markup).toContain('Step 2 of 4');
    expect(markup).toContain(TOUR_PREV_LABEL);
    expect(markup).toContain(TOUR_NEXT_LABEL);
  });

  it('renders Step 3 (timeline step) with appropriate guidance', () => {
    const markup = renderToStaticMarkup(<ProductTour initialStep={2} isOpen={true} onClose={() => undefined} />);

    expect(markup).toContain(TOUR_TIMELINE_TITLE);
    expect(markup).toContain(TOUR_TIMELINE_BODY);
    expect(markup).toContain('Step 3 of 4');
    expect(markup).toContain(TOUR_PREV_LABEL);
    expect(markup).toContain(TOUR_NEXT_LABEL);
  });

  it('renders Step 4 (toolbar step) with Finish ("Got it") button', () => {
    const markup = renderToStaticMarkup(<ProductTour initialStep={3} isOpen={true} onClose={() => undefined} />);

    expect(markup).toContain(TOUR_TOOLBAR_TITLE);
    expect(markup).toContain(TOUR_TOOLBAR_BODY);
    expect(markup).toContain('Step 4 of 4');
    expect(markup).toContain(TOUR_PREV_LABEL);
    expect(markup).toContain(TOUR_FINISH_LABEL);
    // Next label should be replaced by Finish on the last step
    expect(markup).not.toContain(`aria-label="${TOUR_NEXT_LABEL}"`);
  });

  it('contains exactly four defined steps covering search, card, timeline, and toolbar', () => {
    expect(TOUR_STEPS).toHaveLength(4);
    expect(TOUR_STEPS.map((s) => s.id)).toEqual(['search', 'card', 'timeline', 'toolbar']);
  });

  it('positions correctly with fallback when running without DOM elements', () => {
    const markup = renderToStaticMarkup(<ProductTour isOpen={true} onClose={() => undefined} />);
    // Verify top and left inline style attributes are defined and finite
    expect(markup).toMatch(/style="[^"]*top:\s*\d+px/);
    expect(markup).toMatch(/style="[^"]*left:\s*\d+px/);
  });
});
