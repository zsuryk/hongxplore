/**
 * The drag proxy must be the card, not a stand-in for it.
 *
 * **Why this test exists.** While a card is being dragged it is swapped for a drag proxy rendered
 * in screen space, and the proxy used to be built with no `index` and no `onFindSimilar`. The card
 * renders its serial plate and its Find similar button conditionally, so those two elements were
 * absent from the proxy's DOM — and because the card's height is content-driven (DESIGN.md, "the
 * content-driven height rule"), the card the user was carrying came up **45 world units shorter**
 * than the one they picked it up from. That is the layout changing at the exact moment the user is
 * looking at it to aim.
 *
 * **Why it asserts markup, not pixels.** This project's runner is `renderToStaticMarkup` with no
 * layout engine — there is no `getBoundingClientRect` to call, and jsdom would return zeros. But
 * the fix makes the invariant *structural*: the proxy renders the same component with the same
 * props, so its layout box is the card's layout box by construction at every board zoom. Asserting
 * the two markups are identical modulo the animation-state class therefore asserts the layout
 * invariant directly, and it is a stronger statement than a pixel snapshot: it fails the moment
 * anyone adds a conditional element to the card and forgets the proxy.
 *
 * The pixel confirmation is done in a browser instead — see the `offsetWidth`/`offsetHeight`
 * measurement in the PR description (320×485 world units at 38%, 50% and 100% zoom).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import agentResponse from '../../docs/examples/agent-response.json';
import { ActivityCard } from './ActivityCard';
import { FIND_SIMILAR_LABEL, activityCardSerial } from './copy';
import type { components } from './api/schema';

type Match = components['schemas']['MatchedActivity'];
const response = agentResponse as components['schemas']['AgentResponse'];
const match = response.matches[0] as Match;

/**
 * Normalise the one class that is *meant* to differ.
 *
 * `state` carries the motion, not the geometry: `--spawning` is an opacity/translate animation and
 * `--dragging` has no rule at all. The test below asserts that, so stripping the class is only
 * valid as long as neither state can move a box.
 */
function normaliseState(markup: string): string {
  return markup.replace(/ activity-card--(?:spawning|dragging)/g, '');
}

describe('drag proxy layout stability', () => {
  it('renders the card and its drag proxy with identical anatomy', () => {
    const onFindSimilar = () => undefined;

    const atRest = normaliseState(
      renderToStaticMarkup(
        <ActivityCard index={2} match={match} onFindSimilar={onFindSimilar} state="spawning" variant="tall" />,
      ),
    );
    const proxy = normaliseState(
      renderToStaticMarkup(
        <ActivityCard index={2} match={match} onFindSimilar={onFindSimilar} state="dragging" variant="tall" />,
      ),
    );

    // The whole point: byte-identical DOM, so the content-driven height rule cannot produce a
    // different box for the card in hand than for the card it replaced.
    expect(proxy).toBe(atRest);
  });

  it('keeps the serial plate and the Find similar button in the drag proxy', () => {
    const proxy = renderToStaticMarkup(
      <ActivityCard index={2} match={match} onFindSimilar={() => undefined} state="dragging" variant="tall" />,
    );

    // Both are the elements that vanished mid-drag, so both are asserted by name: a future change
    // that drops either from the card must break this loudly rather than silently shrink the drag.
    expect(proxy).toContain(activityCardSerial(2));
    expect(proxy).toContain('activity-card__plate');
    expect(proxy).toContain('activity-card__similar-button');
    expect(proxy).toContain(FIND_SIMILAR_LABEL);
  });

  it('still drops both when the card genuinely does not have them (docked view)', () => {
    // The fix must not leak the plate into the docked timeline card, which has no header plate to
    // put it in. This is the case where omitting them is correct, and it is why the proxy change
    // was made conditional on `source !== 'timeline'` rather than unconditional.
    const docked = renderToStaticMarkup(<ActivityCard match={match} size="docked" />);

    expect(docked).not.toContain('activity-card__plate');
    expect(docked).not.toContain(FIND_SIMILAR_LABEL);
  });

  it('leaves the docked drag proxy byte-identical to before', () => {
    // Dragging a card *out of* a timeline slot renders the docked proxy. That path must not have
    // been disturbed by the canvas fix, so this pins it: passing the serial and the action to a
    // docked card changes nothing at all, because the docked branch returns before reading either.
    const before = renderToStaticMarkup(<ActivityCard match={match} size="docked" state="dragging" />);
    const after = renderToStaticMarkup(
      <ActivityCard index={2} match={match} onFindSimilar={() => undefined} size="docked" state="dragging" />,
    );

    expect(after).toBe(before);
  });

  it('declares no layout-affecting CSS for the dragging state', () => {
    const cardCss = readFileSync(join(import.meta.dirname, 'styles/card.css'), 'utf8');

    // `--dragging` has to stay purely notional. If a future rule gives it geometry, the two
    // markups stop implying the same box and the equality assertion above silently stops meaning
    // what it says.
    expect(cardCss).not.toMatch(/\.activity-card--dragging\b/);
  });
});

/**
 * The pill: the card gets out of the way when it is over a drop zone.
 *
 * At 150% the board card is 480×700 of screen and it sits directly over the timeline slot it is
 * about to be dropped into, so the highlight it is aiming at is invisible at exactly the moment
 * it matters. The card cross-fades to a small serial pill — but **the pill must not cost the
 * layout guarantee above**. These assertions are what hold the two together, because the obvious
 * implementations (scale the proxy down, or re-render it without its anatomy) both quietly break
 * it, and a screenshot cannot tell you that.
 */
describe('drag pill does not move the card in hand', () => {
  const boardCss = readFileSync(join(import.meta.dirname, 'styles/board.css'), 'utf8');

  /** The declarations inside one rule, so a match cannot be satisfied by a different selector. */
  function rule(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return boardCss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
  }

  it('fades the card out with opacity, and never resizes or re-transforms it', () => {
    const scale = rule('.board__drag-scale');
    const pillState = rule('.board__drag--pill .board__drag-scale');

    // Opacity is the *only* property allowed to change. A `scale`, a `width`, a `transform` or a
    // `zoom` here would either shrink the type into a smudge or drag the object out from under
    // the cursor holding it — and, for `transform`, would make the proxy's rendered box disagree
    // with the card's box for the first time.
    expect(pillState).toMatch(/opacity:\s*0/);
    for (const forbidden of ['scale', 'width', 'height', 'transform', 'zoom', 'rotate', 'translate']) {
      expect(
        pillState,
        `.board__drag--pill .board__drag-scale declares \`${forbidden}\`, which would change the proxy's box`,
      ).not.toMatch(new RegExp(`(^|[;{\\s])${forbidden}\\s*:`));
    }
    // And the proxy's own sizing must still be the card's sizing, read from the one token
    // `boardLayout.ts` owns — not a number, and not a second width declared for the pill state.
    expect(scale).toMatch(/width:\s*var\(--card-width\)/);
    expect(scale).toMatch(/zoom:\s*var\(--board-zoom\)/);
  });

  it('takes the pill out of flow, so it cannot contribute a byte to the proxy box', () => {
    // This is what makes the guarantee structural rather than a promise. The pill is a sibling
    // of the card inside `.board__drag`; `position: absolute` is what keeps the proxy's box the
    // card's box.
    expect(rule('.board__drag-pill')).toMatch(/position:\s*absolute/);
    expect(rule('.board__drag-pill')).not.toMatch(/position:\s*(relative|static)/);
  });

  it('keeps the pill itself above the 24px target floor', () => {
    // The pill is a read-out, not a control, so it has no hit area — but a serial rendered
    // smaller than the label scale everywhere else in the app reads as an artefact.
    expect(rule('.board__drag-pill')).toMatch(/min-height:\s*var\(--control-height-sm\)/);
    expect(rule('.board__drag-pill')).toMatch(/min-width:\s*var\(--control-height-sm\)/);
  });

  it('still gets the card out of the way under prefers-reduced-motion', () => {
    const tokenCss = readFileSync(join(import.meta.dirname, 'styles/tokens.css'), 'utf8');

    // The pill may snap instead of cross-fading — that is what the single global block does. What
    // it must never do is vanish, because the card has to uncover the drop target either way.
    // The assertion is that the *opacity* rules are plain (so they survive the duration collapse)
    // and carry no `display`/`visibility` switch the block could not undo.
    expect(rule('.board__drag--pill .board__drag-pill')).toMatch(/opacity:\s*1/);
    expect(boardCss).not.toMatch(/\.board__drag-pill[^{]*\{[^}]*visibility\s*:/);
    expect(boardCss).not.toMatch(/\.board__drag-pill[^{]*\{[^}]*display\s*:\s*none/);
    expect(tokenCss).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it('records the pointer cursor anchor in the stylesheet comment rather than card corner (#139)', () => {
    expect(boardCss).toMatch(/The pill: the card's serial and nothing else, centred directly under the pointer/);
    expect(boardCss).not.toMatch(/centred on the card's own top-left corner/);
  });
});
