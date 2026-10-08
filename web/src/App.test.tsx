import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { BOARD_LABEL, BOARD_KEYBOARD_HINT, GATHERING_INFO_TITLE, TIMELINE_SLOTS } from './copy';
import { CARD_WIDTH } from './boardLayout';
import { useBoardStore } from './state/boardStore';

describe('App shell', () => {
  beforeEach(() => {
    useBoardStore.setState({
      agentLog: [],
      agentStatus: 'idle',
      cards: [],
      discardedCards: [],
      timelineSlots: TIMELINE_SLOTS.map((slot) => ({ ...slot, activityId: null })),
    });
  });

  it('drives the canvas zoom from the viewport instead of hard-coded CSS', () => {
    const markup = renderToStaticMarkup(<App />);

    // The board publishes the geometry the stylesheet reads; `--board-zoom` is what the
    // world layer scales with, and it has to track the viewport state.
    expect(markup).toContain(`--board-zoom:1`);
    expect(markup).toContain(`--card-width:${CARD_WIDTH}px`);
    expect(markup).toContain('class="board__pan"');
    expect(markup).toContain('class="board__world"');
  });

  it('separates the pan layer (screen space) from the zoom layer (world space)', () => {
    const markup = renderToStaticMarkup(<App />);

    const panIndex = markup.indexOf('class="board__pan"');
    const worldIndex = markup.indexOf('class="board__world"');

    expect(worldIndex).toBeGreaterThan(panIndex);
  });

  it('exposes the board as a labelled, focusable, keyboard-operable region', () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain(`aria-label="${BOARD_LABEL}"`);
    expect(markup).toContain('role="region"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('aria-keyshortcuts=');
    expect(markup).toContain('aria-describedby="board-keyboard-hint"');
    expect(markup).toContain(BOARD_KEYBOARD_HINT);
    // `role="application"` hands screen-reader reading keys to the canvas, which this
    // board has no reason to do.
    expect(markup).not.toContain('role="application"');
  });

  it('reports the zoom level through a live region', () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain('aria-live="polite"');
  });

  it('renders the board chrome outside the scaled world layer', () => {
    const markup = renderToStaticMarkup(<App />);
    const panIndex = markup.indexOf('class="board__pan"');

    // `.board__pan` is the root of the zoomed subtree; timeline, discard bin and the
    // empty-state panel all sit before it, so they stay in screen space and never blur
    // or drift as the board is panned and zoomed.
    expect(markup).toContain('class="timeline"');
    expect(markup).toContain('class="discard-bin"');
    expect(markup).toContain('class="board__layer board__layer--center"');
    expect(markup.indexOf('class="timeline"')).toBeLessThan(panIndex);
    expect(markup.indexOf('class="discard-bin"')).toBeLessThan(panIndex);
    expect(markup.indexOf('class="board__layer board__layer--center"')).toBeLessThan(panIndex);
  });

  it('disables zoom controls that would not change anything', () => {
    const markup = renderToStaticMarkup(<App />);

    // At 100% "reset" is a no-op, while both ladder ends stay available.
    expect(markup).toContain('<button aria-label="Reset zoom to 100%" class="btn btn--sm" disabled="" type="button">');
    expect(markup).toContain('<button aria-label="Zoom out" class="btn btn--sm btn--icon" type="button">');
    expect(markup).toContain('<button aria-label="Zoom in" class="btn btn--sm btn--icon" type="button">');
  });

  it('renders the AI research canvas placeholder when searching', () => {
    const markup = renderToStaticMarkup(<App agentStatus="searching" />);

    expect(markup).toContain('class="board__card board__card--research"');
    expect(markup).toContain('activity-card--researching');
    expect(markup).toContain(GATHERING_INFO_TITLE);
  });
});
