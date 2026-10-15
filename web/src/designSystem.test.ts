/**
 * Design-system contract tests.
 *
 * These are the pre-agreed TDD seams for the #74 redesign. They turn `DESIGN.md` from prose
 * into something the build enforces:
 *
 *  1. every semantic role the document names must exist in the token layer;
 *  2. component CSS must not reintroduce raw colour literals (the "raw values are bugs" rule);
 *  3. the WCAG thresholds `DESIGN.md` states must hold, recomputed from the token values —
 *     including the pairs that are deliberately *not* enforced, recorded so nobody "fixes" them.
 *
 * Visual craft is not testable here and is verified in a browser instead. See the "Verified"
 * section of DESIGN.md.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const STYLES_DIR = join(import.meta.dirname, 'styles');
const TOKEN_FILE = 'tokens.css';

/**
 * Read every stylesheet off disk.
 *
 * `import.meta.glob('./styles/*.css', { query: '?raw' })` looks like the tidier option and
 * enumerates itself, but Vitest stubs CSS imports to empty strings unless CSS processing is
 * switched on globally — so every variant resolves to `''`. Turning it on would slow all 11
 * suites to gain nothing, so the files are read directly instead.
 */
const read = (file: string): string => readFileSync(join(STYLES_DIR, file), 'utf8');

type ComponentCss = { file: string; css: string };
const componentCss: ComponentCss[] = readdirSync(STYLES_DIR)
  .filter((file) => file.endsWith('.css') && file !== TOKEN_FILE)
  .sort()
  .map((file) => ({ file, css: read(file) }));

const tokenCss = read(TOKEN_FILE);

/* ------------------------------------------------------------------ colour maths */

function relativeLuminance(hex: string): number {
  const v = hex.replace('#', '');
  const full =
    v.length === 3
      ? v
          .split('')
          .map((c) => c + c)
          .join('')
      : v;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The `:root` block only. The token file also carries a `[data-theme='light']` block for the
 * future second theme, and reading both would let the later block overwrite the shipped
 * values — the contract test must assert against the theme that actually ships.
 */
function rootBlock(): string {
  const start = tokenCss.indexOf(':root');
  if (start === -1) throw new Error('tokens.css declares no :root block');
  const open = tokenCss.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < tokenCss.length; i++) {
    if (tokenCss[i] === '{') depth++;
    else if (tokenCss[i] === '}' && --depth === 0) return tokenCss.slice(open + 1, i);
  }
  throw new Error('tokens.css :root block is not closed');
}

/** Resolve every `--token: value` declaration in the shipped `:root` block. */
function tokens(): Map<string, string> {
  const map = new Map<string, string>();
  for (const [, name, value] of rootBlock().matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    map.set(name, value.trim());
  }
  return map;
}

/** Resolve a token to a hex colour, following `var(--other)` aliases. */
function colour(t: Map<string, string>, name: string, depth = 0): string {
  if (depth > 8) throw new Error(`token alias cycle resolving ${name}`);
  const raw = t.get(name);
  if (raw === undefined) throw new Error(`missing token --${name}`);
  const aliased = raw.match(/^var\(--([a-z0-9-]+)\)$/);
  if (aliased) return colour(t, aliased[1], depth + 1);
  const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) return raw;
  throw new Error(`token --${name} is "${raw}", which is not a plain hex colour`);
}

/* ------------------------------------------------------------ 1. token completeness */

/** Every semantic role DESIGN.md names as load-bearing. */
const REQUIRED_ROLES = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'card-muted-foreground',
  'primary',
  'primary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'border',
  'input',
  'ring',
  'popover',
  // Brand tokens
  'rule',
  'lamp-live',
  'lamp-pending',
  'lamp-cancelled',
  'success',
  'warning',
  'row-rule',
] as const;

describe('token layer', () => {
  const t = tokens();

  it.each(REQUIRED_ROLES)('defines the --%s role', (role) => {
    expect(t.has(role), `token layer is missing --${role}`).toBe(true);
  });

  it('resolves every semantic role to a hex colour', () => {
    for (const role of REQUIRED_ROLES) {
      expect(() => colour(t, role), `--${role} must resolve to a hex colour`).not.toThrow();
    }
  });

  it('ships the tokens on :root so they resolve at runtime, not only in a dead selector', () => {
    // A token declared only inside a media query or a scoped selector is unreachable at runtime.
    const declaredInRoot = rootBlock();
    const orphans = [...tokens().keys()].filter((name) => !declaredInRoot.includes(`--${name}:`));
    expect(orphans, `declared outside :root: ${orphans.join(', ')}`).toEqual([]);
  });

  it('declares the shipped theme and records the second theme as unreachable', () => {
    // DESIGN.md records dark-first, single theme. A light block may exist for the future, but it
    // must not be selectable today — nothing may set data-theme to anything but the shipped name.
    expect(tokenCss).toContain("[data-theme='blue-hour']");
    expect(tokenCss).toContain("[data-theme='light']");
    expect(tokenCss).toMatch(/Single shipped theme/);
  });

  it('gives every injected deal duration a valid pre-injection default', () => {
    // The card deal's `animation` shorthand reads `--deal-delay` and `--deal-travel`. Those are
    // injected per card from `dealTiming()`, but between the stylesheet parsing and the first
    // React render they are *unset* — and an unresolved `var()` inside a shorthand does not fall
    // back, it invalidates the entire declaration. That is not hypothetical: auto-tile's old
    // transition read `--motion-duration-slow`, which no block ever defined, so the whole
    // shorthand was dead and auto-tile snapped instantly for as long as that rule existed.
    //
    // This assertion is the guard against repeating it. A `0ms` default is also the *correct*
    // pre-injection behaviour: a card with no deal placement must not be animated at all.
    const declared = tokens();
    for (const name of ['deal-delay', 'deal-travel']) {
      const value = declared.get(name);
      expect(value, `--${name} has no :root default`).toBeDefined();
      expect(value, `--${name} is "${value}", which is not a time value`).toMatch(/^\d+(\.\d+)?m?s$/);
    }
    expect(declared.get('deal-pile-scale')).toMatch(/^0?\.\d+$/);
    expect(declared.get('deal-tilt')).toMatch(/^-?\d+(\.\d+)?deg$/);
  });
});

/* ---------------------------------------------------------- 2. no raw colour values */

/** Colours are banned outside the token layer. Board geometry is injected by boardLayout.ts. */
const RAW_COLOUR_SOURCE = String.raw`#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(`;
const RAW_COLOUR = new RegExp(RAW_COLOUR_SOURCE, 'gi');
/** Non-global twin for `.test()` — a /g regex carries lastIndex between calls. */
const RAW_COLOUR_TEST = new RegExp(RAW_COLOUR_SOURCE, 'i');

describe('component CSS', () => {
  it.each(componentCss.map((c) => c.file))('%s introduces no raw colour literals', (file) => {
    const { css } = componentCss.find((c) => c.file === file)!;
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, ''); // comments may name colours for justification
    const offenders = [...stripped.matchAll(RAW_COLOUR)].map((m) => m[0]);
    expect(
      offenders,
      `${file} has raw colour literal(s): ${[...new Set(offenders)].join(', ')}. ` +
        `Every colour must come from a token in tokens.css.`,
    ).toEqual([]);
  });

  /**
   * The token rule applies to JS too. A hardcoded hex in a component is the same defect as one in
   * a stylesheet, and it is worse because nothing else scans for it: the particle palette shipped
   * as six literal cosmic hexes in `App.tsx` long after the CSS layer had been tokenised.
   *
   * Deliberately narrow — it allows non-colour hex (none today) and requires any future hex to be
   * a token reference, so a value that must vary at runtime is read via `getComputedStyle`.
   */
  it('introduces no raw colour literals in component source', () => {
    const sourceFiles = ['App.tsx', 'ActivityCard.tsx', 'BoardToolbar.tsx', 'SearchBar.tsx', 'AgentStatusPanel.tsx'];
    const offenders = sourceFiles.flatMap((file) => {
      const src = readFileSync(join(import.meta.dirname, file), 'utf8');
      const hits = src.match(/#[0-9a-f]{3,8}\b|\brgba?\(/gi) ?? [];
      return hits.length ? [`${file}: ${[...new Set(hits)].join(', ')}`] : [];
    });
    expect(
      offenders,
      `Raw colour literal(s) in component source: ${offenders.join('; ')}. ` +
        `Add a token to tokens.css and read it via getComputedStyle instead.`,
    ).toEqual([]);
  });

  it('keeps the token layer the only file that writes colour values', () => {
    // NOTE: a /g regex is stateful across `.test()` calls via lastIndex, so it is rebuilt here
    // rather than reused from the module-scope matchAll pattern.
    const writers = componentCss.filter((entry) => RAW_COLOUR_TEST.test(entry.css)).map((entry) => entry.file);
    expect(writers).toEqual([]);
  });
});

/* ------------------------------------------------------------------- 3. contrast */

const t = tokens();
const hex = (name: string) => colour(t, name);

describe('WCAG contrast, recomputed from the token layer', () => {
  const textPairs: Array<[string, string, number, string]> = [
    ['foreground', 'background', 4.5, 'body text on the canvas'],
    ['foreground', 'card', 4.5, 'text on a popover'],
    ['card-foreground', 'card', 4.5, 'card title and rationale'],
    ['card-muted-foreground', 'card', 4.5, 'card metadata line'],
    ['muted-foreground', 'muted', 4.5, 'muted chrome text'],
    ['muted-foreground', 'background', 4.5, 'chrome text on the canvas'],
    ['primary-foreground', 'primary', 4.5, 'label on a primary fill'],
    ['accent-foreground', 'accent', 4.5, 'label on an accent fill'],
    ['destructive', 'card', 4.5, 'discard action on a card'],
    ['destructive', 'background', 4.5, 'discard action on the canvas'],
  ];

  it.each(textPairs)('%s on %s clears 4.5:1 (%s)', (fg, bg, threshold, what) => {
    const ratio = contrast(hex(fg), hex(bg));
    expect(ratio, `${what}: ${fg} ${hex(fg)} on ${bg} ${hex(bg)} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      threshold,
    );
  });

  const boundaryPairs: Array<[string, string, number, string]> = [
    ['border', 'background', 3, 'card outline against the canvas — WCAG 1.4.11'],
    ['border', 'card', 3, 'card outline against its own face — WCAG 1.4.11'],
    ['rule', 'muted', 3, 'timeline cell divider — a meaningful UI boundary'],
    ['ring', 'card', 3, 'focus ring against a card — WCAG 1.4.11'],
    ['ring', 'background', 3, 'focus ring against the canvas — WCAG 1.4.11'],
    // The drag pill. Its border and its serial are the only things identifying it while the card
    // it belongs to is faded out, and it sits over whatever drop zone the user is aiming at —
    // a slot, or the discard bin. So it is gated against both faces it can land on.
    ['accent', 'popover', 3, 'drag pill border against its own face — WCAG 1.4.11'],
    ['accent', 'primary-soft', 3, 'drag pill over the amber drop-target slot'],
    ['accent', 'destructive-soft', 3, 'drag pill over the active discard bin'],
  ];

  it.each(boundaryPairs)('%s against %s clears 3:1 (%s)', (fg, bg, threshold, what) => {
    const ratio = contrast(hex(fg), hex(bg));
    expect(ratio, `${what}: ${fg} ${hex(fg)} on ${bg} ${hex(bg)} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      threshold,
    );
  });

  it('keeps the drag pill serial readable as text, not just as a boundary', () => {
    // The pill's whole content is the serial. A 3:1 pass on its border would leave a 12px glyph
    // failing the body-text floor, which is the more likely failure and the more useless one.
    const ratio = contrast(hex('accent'), hex('popover'));

    expect(ratio, `drag pill serial: accent on popover = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });

  /**
   * Deliberate non-pairs. DESIGN.md records why these fail and what carries the separation
   * instead. Asserting they *stay* weak is what stops a well-meaning PR from "fixing" them.
   */
  it('records the card-face-vs-canvas pair as a deliberate non-pair', () => {
    const ratio = contrast(hex('card'), hex('background'));
    expect(
      ratio,
      'card on background is below 3:1 by design — separation is carried by --rule. ' +
        'If this now passes, DESIGN.md must be updated to say the outline is no longer load-bearing.',
    ).toBeLessThan(3);
  });

  it('uses amber for pending only, never as a structural boundary', () => {
    // Amber is the pending lamp. If it were the card outline, twelve of them read as an error state.
    expect(hex('lamp-pending')).toBe(hex('primary'));
    expect(hex('rule')).not.toBe(hex('lamp-pending'));
  });
});

/* --------------------------------------------------- 4. the composite control tier */

/**
 * One control tier in the status strip.
 *
 * A composite control — the segmented data-source switch is the app's only one — insets its
 * targets inside a tray, so its box is necessarily taller than a single control's. That is
 * arithmetic, not taste: `target + 2×inset + 2×bezel` = 24 + 4 + 2 = 30px, and no way of drawing
 * it makes a 24px tray hold two 24px targets without them touching its bezel.
 *
 * The consequence is that the controls standing beside it have to match the tray's *box* rather
 * than its 24px target, or two same-weight controls in one row read as two unrelated controls.
 * Getting that wrong is the bug this section pins: the tray sat at 30px next to a 24px button,
 * vertically centred against each other, with the same bezel and the same corner.
 *
 * The assertions are on the *declaration*, not the rendered pixel, because the runner has no
 * layout engine. Both selectors must consume the one token — that is what makes the tier a value
 * they read rather than a number somebody has to remember.
 */
describe('composite control tier', () => {
  const t = tokens();
  const controlsCss = read('controls.css');
  const panelsCss = read('panels.css');

  /** Resolve a rem/px token to CSS pixels. The control scale is authored in both units. */
  function px(name: string): number {
    const raw = t.get(name);
    if (raw === undefined) throw new Error(`missing token --${name}`);
    const rem = raw.match(/^([\d.]+)rem$/);
    if (rem) return Number(rem[1]) * 16;
    const literal = raw.match(/^([\d.]+)px$/);
    if (literal) return Number(literal[1]);
    throw new Error(`token --${name} is "${raw}", which is not a px/rem length`);
  }

  it('derives the composite tier from the small target rather than restating it', () => {
    // Guards against someone "simplifying" the calc into a literal 30px, which would silently
    // decouple the tier from `--control-height-sm` and let a future target-size change drift.
    expect(t.get('control-height-composite')).toContain('var(--control-height-sm)');
    expect(t.get('control-height-composite')).toContain('var(--control-inset)');
  });

  it('resolves to exactly target + 2×inset + 2×bezel', () => {
    const expected = px('control-height-sm') + 2 * px('control-inset') + 2 * px('control-border-width');
    const declared = t.get('control-height-composite') ?? '';

    // Evaluate the calc rather than pattern-matching it. `2 * var(--control-inset)` has to be
    // read as a product: summing the bare `2` and the var separately silently passes a wrong
    // expression, which is the failure this test is here to catch.
    const total = declared
      // Substitute the var() references *first* — their parens are part of the reference, so
      // stripping parens before this would shred `var(--x)` into two bare words.
      .replace(/var\(--([a-z0-9-]+)\)/gi, (_, name: string) => String(px(name)))
      // What is left is `calc( A + B + C )`: drop the wrapper, then evaluate it as a sum of
      // products so `2 * 2` is read as a product rather than summed into 4 by accident.
      .replace(/\bcalc\b/gi, ' ')
      .replace(/[()]/g, ' ')
      .split('+')
      .map((term) =>
        term
          .split('*')
          .map((factor) => Number(factor.trim()))
          .reduce((a, b) => a * b),
      )
      .reduce((a, b) => a + b, 0);

    expect(total, `--control-height-composite evaluates to ${total}px, expected ${expected}px`).toBe(expected);
    expect(expected).toBe(30);
  });

  it('never drops a composite control target below the 24px floor', () => {
    // The whole reason the tray is 30px rather than 24px. WCAG 2.5.8 measures the thing the
    // pointer has to hit, which for a segmented control is the option, not the tray around it.
    expect(px('control-height-sm')).toBeGreaterThanOrEqual(24);
    expect(controlsCss).toMatch(/\.segmented__option\s*\{[^}]*min-height:\s*var\(--control-height-sm\)/);
  });

  it('sizes the tray and its neighbours off the same token', () => {
    expect(controlsCss).toMatch(/\.segmented\s*\{[^}]*min-height:\s*var\(--control-height-composite\)/);
    expect(panelsCss).toMatch(
      /\.agent-status-panel__actions\s*>\s*\.btn\s*\{[^}]*min-height:\s*var\(--control-height-composite\)/,
    );
  });

  it('gives the composite tray the same radius and bezel weight as the buttons beside it', () => {
    const tray = controlsCss.match(/\.segmented\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(tray).toMatch(/border:\s*var\(--control-border-width\)\s+solid\s+var\(--rule\)/);
    expect(tray).toMatch(/border-radius:\s*var\(--radius-md\)/);
  });
});
