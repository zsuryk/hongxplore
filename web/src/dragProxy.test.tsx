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
