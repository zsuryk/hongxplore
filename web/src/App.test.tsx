import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import {
  AUTO_FIT_LABEL,
  AUTO_FIT_DESCRIPTION,
  AUTO_TILE_LABEL,
  BOARD_LABEL,
  BOARD_KEYBOARD_HINT,
  CLEAR_BOARD_CONFIRM_TITLE,
  DISCARD_GUIDE_TOAST,
  GATHERING_INFO_TITLE,
  TIMELINE_COLLAPSE_LABEL,
  TIMELINE_COLLAPSED_HINT,
  TIMELINE_COLLAPSED_LABEL,
  TIMELINE_DRAG_COLLAPSE_HINT,
  TIMELINE_EXPAND_LABEL,
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

    // At 100% "reset" is a no-op, while both ladder ends stay available. The rail is
    // icon-only, so the zoom steps are `btn--icon` and the readout doubles as the reset.
    expect(markup).toContain('<button aria-label="Reset zoom to 100%" class="board-toolbar__readout" disabled=""');
    expect(markup).toContain('<button aria-label="Zoom out" class="btn btn--sm btn--icon board-toolbar__btn"');
    expect(markup).toContain('<button aria-label="Zoom in" class="btn btn--sm btn--icon board-toolbar__btn"');
  });

  it('renders the AI research canvas placeholder when searching', () => {
    const markup = renderToStaticMarkup(<App agentStatus="searching" />);

    expect(markup).toContain('class="board__card board__card--research"');
    expect(markup).toContain('activity-card--researching');
    expect(markup).toContain(GATHERING_INFO_TITLE);
  });

  it('renders collapsed timeline dock as accessible button with aria-expanded="false" and guide hints', () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain('class="timeline timeline--collapsed"');
    expect(markup).toContain(`aria-label="${TIMELINE_EXPAND_LABEL}"`);
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain(TIMELINE_COLLAPSED_LABEL);
    expect(markup).toContain(TIMELINE_GUIDE_TOAST);
    expect(markup).toContain(DISCARD_GUIDE_TOAST);
    expect(markup).not.toContain('viewport-controls__guide-hint');
    expect(markup).not.toContain('role="button"');
  });

  it('renders user-expanded timeline with slot labels, planned count, and collapse button', () => {
    const markup = renderToStaticMarkup(<App initialTimelineExpanded={true} />);

    expect(markup).toContain('class="timeline timeline--expanded"');
    expect(markup).toContain(`aria-label="${TIMELINE_COLLAPSE_LABEL}"`);
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('timeline__count-badge');
    expect(markup).toContain('Saturday morning');
    expect(markup).toContain('Sunday evening');
  });

  it('renders hover-expanded timeline with slot labels and planned count', () => {
    const markup = renderToStaticMarkup(<App initialHoverExpanded={true} />);

    expect(markup).toContain('class="timeline timeline--expanded timeline--hover-expanded"');
    expect(markup).toContain(TIMELINE_DRAG_COLLAPSE_HINT);
    expect(markup).toContain('timeline__count-badge');
    expect(markup).toContain('Saturday morning');
    expect(markup).toContain('Sunday evening');
  });

  it('does not offer the drag hint for a timeline that was only clicked', () => {
    // "Press Esc or click _ to minimize" is the affordance for a card in hand. Offering it to
    // somebody who has merely opened the panel invites them to undo something they never did.
    // This is a real regression, caught in a screenshot: the hover preview and the drag expansion
    // originally shared one flag, so every plain hover got the drag hint.
    const pinned = renderToStaticMarkup(<App initialTimelineExpanded={true} />);
    const dragged = renderToStaticMarkup(<App initialHoverExpanded={true} />);

    expect(pinned).not.toContain(TIMELINE_DRAG_COLLAPSE_HINT);
    expect(dragged).toContain(TIMELINE_DRAG_COLLAPSE_HINT);
  });

  it('renders the Auto-fit toggle switch with accessible tooltip description in board toolbar', () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain('class="board-toolbar"');
    expect(markup).toContain('id="autofit-toggle"');
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

  it('keeps the header restricted to brand and search only without viewport controls', () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain('class="app__header-brand"');
    expect(markup).toContain('class="app__header-search"');
    expect(markup).not.toContain('class="viewport-controls"');
    expect(markup).not.toContain('class="viewport-controls__zoom"');
  });

  it('renders the clear board confirmation modal when isClearConfirmOpen is true', () => {
    const markup = renderToStaticMarkup(<App initialClearConfirmOpen={true} />);

    expect(markup).toContain('class="board-modal-backdrop"');
    expect(markup).toContain('role="alertdialog"');
    expect(markup).toContain(CLEAR_BOARD_CONFIRM_TITLE);
  });

  it('renders the auto-tile button in the board toolbar, enabled with cards and disabled when empty', () => {
    const emptyMarkup = renderToStaticMarkup(<App cards={[]} />);
    expect(emptyMarkup).toContain(
      `<button aria-label="${AUTO_TILE_LABEL}" class="btn btn--sm btn--icon board-toolbar__btn" disabled=""`,
    );

    const mockCards = [
      {
        activity: {
          id: 'test-card-1',
          title: 'Test Card',
          title_en: 'Test Card',
          lang: 'en' as const,
          url: 'https://example.com',
          tags: ['culture'],
          parts: [{ start: '2026-10-10T06:00:00Z', end: '2026-10-10T08:00:00Z' }],
          source: { name: 'Source' },
          location: { district: 'Central', venue: 'Venue' },
        },
        match_rationale: 'Perfect fit',
      },
    ];
    const cardsMarkup = renderToStaticMarkup(<App cards={mockCards} />);
    expect(cardsMarkup).toContain(
      `<button aria-label="${AUTO_TILE_LABEL}" class="btn btn--sm btn--icon board-toolbar__btn"`,
    );
    expect(cardsMarkup).not.toContain(
      `<button aria-label="${AUTO_TILE_LABEL}" class="btn btn--sm btn--icon board-toolbar__btn" disabled=""`,
    );
  });

  it('numbers canvas cards with a zero-padded serial in the header plate', () => {
    const mockCards = [
      {
        activity: {
          id: 'serial-card-1',
          title: 'First card',
          title_en: 'First card',
          lang: 'en' as const,
          url: 'https://example.com',
          tags: ['culture'],
          parts: [{ start: '2026-10-10T06:00:00Z', end: '2026-10-10T08:00:00Z' }],
          source: { name: 'Source' },
          location: { district: 'Central', venue: 'Venue' },
        },
        match_rationale: 'Perfect fit',
      },
    ];
    const markup = renderToStaticMarkup(<App cards={mockCards} />);

    // The serial is aria-hidden: the card's accessible name is its title, and "01" adds
    // nothing to it. It is the row number you read, not something to hear.
    expect(markup).toContain('class="activity-card__plate">01<');
    expect(markup).toContain('<span aria-hidden="true" class="activity-card__plate">');
  });

  it('names all three ways into the timeline, now that hover is one of them', () => {
    const markup = renderToStaticMarkup(<App />);

    // The hint is what the eye reads; the button's `aria-label` is what a screen reader hears,
    // and the hint must not tell a keyboard user to hover at something they cannot do. It says
    // "click" for them, which activates the same button and pins the timeline open.
    expect(markup).toContain(TIMELINE_COLLAPSED_HINT);
    expect(TIMELINE_COLLAPSED_HINT).toMatch(/hover/i);
    expect(TIMELINE_COLLAPSED_HINT).toMatch(/click/i);
    expect(TIMELINE_GUIDE_TOAST).toMatch(/hover/i);
  });
});

/**
 * The collapsed timeline now previews on hover, and the three ways that usually goes wrong are
 * all prevented by one geometric fact: **the collapsed panel's rect is contained in the expanded
 * panel's rect**. Both are anchored to the same `bottom`, and the expanded one is wider and
 * taller, so growing the panel can never eject the pointer from under itself — which is what
 * turns a naive `:hover` rule into an open/close loop.
 *
 * That is a property of the stylesheet, so it is asserted here rather than in a screenshot.
 * Measured in the browser at 1600×1000: collapsed `(20, 922) 352×58`, expanded
 * `(20, 742) 672×238` — containment confirmed, and the pointer stayed inside.
 */
describe('timeline hover geometry', () => {
  const css = readFileSync(join(import.meta.dirname, 'styles/timeline.css'), 'utf8');
  const block = (selector: string) =>
    css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

  it('anchors both states to the same bottom edge', () => {
    // Different anchors are how the panel grows *downward over the thing being aimed at*, which
    // would put the growing edge under the pointer and re-trigger the collapse.
    expect(block('.timeline')).toMatch(/bottom:\s*var\(--space-5\)/);
    expect(block('.timeline--collapsed')).not.toMatch(/bottom\s*:/);
    expect(block('.timeline--collapsed')).not.toMatch(/top\s*:/);
  });

  it('keeps the collapsed panel no wider than the expanded one', () => {
    const collapsedWidth = block('.timeline--collapsed').match(/width:\s*([^;]+);/)?.[1];
    const expandedWidth = block('.timeline').match(/width:\s*([^;]+);/)?.[1];

    // `min(22rem, …)` against `min(42rem, …)`, with the same viewport term in both. Both are
    // clamped by the same `calc(100% - 10rem)`, so this holds at every width including mobile,
    // where the collapsed override also collapses to `auto`.
    expect(collapsedWidth).toBeDefined();
    expect(expandedWidth).toBeDefined();
    expect(collapsedWidth).toMatch(/22rem/);
    expect(expandedWidth).toMatch(/42rem/);
    expect(block('.timeline--collapsed')).toMatch(/width:\s*min\(22rem,\s*calc\(100% - 10rem\)\)/);
  });

  it('never lets the floating guide hint take a pointer event while the panel grows upward', () => {
    // The hint sits above the panel. If it caught the pointer it would sit between the cursor and
    // the collapsed bar, and every hover would read as a leave.
    expect(block('.timeline__guide-hint')).toMatch(/pointer-events:\s*none/);
    expect(block('.discard-bin__guide-hint')).toMatch(/pointer-events:\s*none/);
  });
});
