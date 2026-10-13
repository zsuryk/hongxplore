import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import {
  AUTO_FIT_LABEL,
  AUTO_FIT_DESCRIPTION,
  BOARD_LABEL,
  BOARD_KEYBOARD_HINT,
  DISCARD_GUIDE_TOAST,
  GATHERING_INFO_TITLE,
  TIMELINE_COLLAPSED_LABEL,
  TIMELINE_GUIDE_TOAST,
  TIMELINE_SLOTS,
  timelineActivityDockedConfirmation,
  timelineActivityReplacedConfirmation,
  timelineSlotMismatchMessage,
} from './copy';
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
    expect(markup).toContain('class="timeline');
    expect(markup).toContain('class="discard-bin"');
    expect(markup).toContain('class="board__layer board__layer--center"');
    expect(markup.indexOf('class="timeline')).toBeLessThan(panIndex);
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

  it('renders collapsed timeline dock and remaining floating guide hints on load without autofit bubble', () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain('timeline--collapsed');
    expect(markup).toContain(TIMELINE_COLLAPSED_LABEL);
    expect(markup).toContain(TIMELINE_GUIDE_TOAST);
    expect(markup).toContain(DISCARD_GUIDE_TOAST);
    expect(markup).not.toContain('viewport-controls__guide-hint');
  });

  it('renders the Auto-fit toggle checkbox with accessible tooltip description', () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain('class="viewport-controls__autofit"');
    expect(markup).toContain('class="viewport-controls__checkbox"');
    expect(markup).toContain(AUTO_FIT_LABEL);
    expect(markup).toContain('aria-describedby="autofit-description"');
    expect(markup).toContain('id="autofit-description"');
    expect(markup).toContain(AUTO_FIT_DESCRIPTION);
  });

  it('renders successful dock confirmation on the accessible board toast surface', () => {
    const dockMessage = timelineActivityDockedConfirmation('Saturday afternoon');
    const markup = renderToStaticMarkup(<App initialConfirmation={dockMessage} />);

    expect(markup).toContain('class="board__toast"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain(dockMessage);
  });

  it('renders slot mismatch and replace confirmations on the same accessible toast surface', () => {
    const mismatchMessage = timelineSlotMismatchMessage('Saturday morning');
    const mismatchMarkup = renderToStaticMarkup(<App initialConfirmation={mismatchMessage} />);

    expect(mismatchMarkup).toContain('class="board__toast"');
    expect(mismatchMarkup).toContain('role="status"');
    expect(mismatchMarkup).toContain('aria-live="polite"');
    expect(mismatchMarkup).toContain(mismatchMessage);

    const replaceMessage = timelineActivityReplacedConfirmation('Art Workshop');
    const replaceMarkup = renderToStaticMarkup(<App initialConfirmation={replaceMessage} />);

    expect(replaceMarkup).toContain('class="board__toast"');
    expect(replaceMarkup).toContain('role="status"');
    expect(replaceMarkup).toContain('aria-live="polite"');
    expect(replaceMarkup).toContain('Art Workshop');
    expect(replaceMarkup).toContain('Replaced');
  });

  it('renders expanded timeline slots with aria-live="polite" and handles docked slot states', () => {
    const mockCards = [
      {
        activity: {
          id: 'docked-test-activity',
          title: 'Test Docked Activity',
          title_en: 'Test Docked Activity',
          lang: 'en' as const,
          url: 'https://example.com',
          tags: ['culture'],
          parts: [{ start: '2026-10-10T06:00:00Z', end: '2026-10-10T08:00:00Z' }],
          source: { name: 'Source' },
          location: { district: 'Central', venue: 'Venue' },
        },
        match_rationale: 'Perfect cultural fit',
      },
    ];

    const mockSlots = [
      { id: 'saturday-afternoon', activityId: 'docked-test-activity' },
      ...TIMELINE_SLOTS.filter((s) => s.id !== 'saturday-afternoon').map((slot) => ({ ...slot, activityId: null })),
    ];

    const markup = renderToStaticMarkup(
      <App cards={mockCards} initialTimelineExpanded={true} timelineSlots={mockSlots} />,
    );

    expect(markup).toContain('timeline--expanded');
    expect(markup).toContain('data-timeline-slot="saturday-afternoon"');
    expect(markup).toContain('timeline__slot--docked');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('Test Docked Activity');
  });
});
