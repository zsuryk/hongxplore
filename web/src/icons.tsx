/**
 * The app's icon set, authored inline.
 *
 * **Why not a dependency.** This app has no icon package and DESIGN.md records that the
 * toolbar lives in screen space outside the zoomed world; a 16px stroke icon set is a few
 * hundred bytes of path data, and shipping an icon font or a package for six glyphs would add
 * a build dependency, a FOUT window and a second place where icon weight could drift.
 *
 * **One drawing, one weight.** Every glyph is authored on the same 24-unit grid with a single
 * `--icon-stroke` weight, round caps and round joins, and no fills. That is what makes a 16px
 * glyph and a 20px glyph read as the same hand rather than as two styles.
 *
 * Sizing is CSS (`.icon { width: var(--icon-size) }`) rather than `width`/`height` attributes,
 * so there is exactly one place where an icon's size is decided and `--icon-size` can change it
 * for every glyph at once. `focusable="false"` keeps IE-era edge-to-edge focusable in Safari
 * from putting these decorative SVGs into the tab order — the wrapping button owns the name.
 */
import type { SVGProps } from 'react';

export type IconName =
  'zoom-in' | 'zoom-out' | 'reset' | 'fit' | 'auto-fit' | 'tile' | 'clear' | 'close' | 'search' | 'pending';

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'strokeWidth'>;

/**
 * The shared wrapper. Every path below is drawn in the same 24×24 space, on the same baseline.
 *
 * The caller's `className` is merged rather than replacing `icon`: without the base class the
 * SVG has no intrinsic size and stretches to the 300×150 default, which is how the search
 * glyph once grew to fill the whole header.
 */
function Svg({ children, className, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      className={className ? `icon ${className}` : 'icon'}
      fill="none"
      focusable="false"
      shapeRendering="geometricPrecision"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
      {...props}
    >
      {children}
    </svg>
  );
}

/**
 * Magnifier carrying the operation, rather than a bare plus/minus: at 16px a naked `+` and a
 * naked `−` are near-identical grey strokes, and the lens is what says "this is the viewport".
 */
function ZoomGlyph({ axis }: { axis: 'in' | 'out' }) {
  return (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M14.8 14.8 20.5 20.5" />
      {axis === 'out' ? <path d="M7.5 10.5h6" /> : <path d="M7.5 10.5h6M10.5 7.5v6" />}
    </>
  );
}

export function IconZoomOut(props: IconProps) {
  return (
    <Svg {...props}>
      <ZoomGlyph axis="out" />
    </Svg>
  );
}

export function IconZoomIn(props: IconProps) {
  return (
    <Svg {...props}>
      <ZoomGlyph axis="in" />
    </Svg>
  );
}

/**
 * Actual size. An outlined frame with a filled plate in the middle: "the content at 1:1".
 * A literal "100%" does not fit a 16px glyph, and `1:1` set as type turns into an icon-shaped
 * string at this size, so it is drawn instead.
 */
export function IconReset(props: IconProps) {
  return (
    <Svg {...props}>
      <rect height="16" rx="1.5" width="19" x="2.5" y="4" />
      <rect height="8" rx="1" width="8" x="8" y="8" />
    </Svg>
  );
}

/** Fit to content — four corner brackets closing in on the card pile. */
export function IconFit(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
    </Svg>
  );
}

/** Auto-fit — arrows collapsing inward to a centre line: the board framing itself. */
export function IconAutoFit(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 12h6M6 9l-3 3 3 3M21 12h-6M18 9l3 3-3 3" />
    </Svg>
  );
}

/** Auto-tile — the four cells the board packs into. */
export function IconTile(props: IconProps) {
  return (
    <Svg {...props}>
      <rect height="7.5" rx="1" width="7.5" x="3" y="3" />
      <rect height="7.5" rx="1" width="7.5" x="13.5" y="3" />
      <rect height="7.5" rx="1" width="7.5" x="3" y="13.5" />
      <rect height="7.5" rx="1" width="7.5" x="13.5" y="13.5" />
    </Svg>
  );
}

/** Clear board — the one destructive control in the rail. Read with `--destructive`. */
export function IconClear(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 12.5h9L17.5 7" />
    </Svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M14.8 14.8 20.5 20.5" />
    </Svg>
  );
}

/**
 * Pending. A split-flap cell mid-turn — two plates with the join between them lit in the
 * pending colour. Amber means "waiting on you" and nothing else, so this is the one place a
 * card-level mark may wear it.
 */
export function IconPending(props: IconProps) {
  return (
    <Svg {...props}>
      <rect height="8" rx="1" width="16" x="4" y="4" />
      <rect height="8" rx="1" width="16" x="4" y="12" />
      <path d="M4 12h16" />
    </Svg>
  );
}

/**
 * Dismiss. Two diagonals at the same 45° the grid's own rule runs at, so it reads as part of the
 * instrument rather than as a typographic `×` — an SVG keeps it on the 24-unit grid with the rest
 * of the set, where a text glyph would sit on the baseline at whatever size the font guessed.
 */
export function IconClose(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </Svg>
  );
}

/** Kept as a lookup so a control can declare an icon by name instead of by element. */
export const ICONS = {
  'auto-fit': IconAutoFit,
  clear: IconClear,
  close: IconClose,
  fit: IconFit,
  pending: IconPending,
  reset: IconReset,
  search: IconSearch,
  tile: IconTile,
  'zoom-in': IconZoomIn,
  'zoom-out': IconZoomOut,
} satisfies Record<IconName, (props: IconProps) => React.ReactElement>;
