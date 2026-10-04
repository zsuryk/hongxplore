import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FREE_TIME_SLOTS, SEARCH_SUBMIT_LABEL } from './copy';
import { SearchBar } from './SearchBar';

describe('SearchBar', () => {
  it('renders the search input, submit button, and time-slot chips', () => {
    const markup = renderToStaticMarkup(<SearchBar selectedSlotIds={['saturday-afternoon']} status="idle" />);

    expect(markup).toContain('search-bar__input');
    expect(markup).toContain(SEARCH_SUBMIT_LABEL);
    for (const slot of FREE_TIME_SLOTS) {
      expect(markup).toContain(slot.label);
    }
    expect(markup).toContain('search-bar__chip--selected');
  });

  it('renders disabled state when searching', () => {
    const markup = renderToStaticMarkup(<SearchBar status="searching" />);

    expect(markup).toContain('disabled=""');
  });
});
