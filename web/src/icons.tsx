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
  | 'zoom-in'
  | 'zoom-out'
  | 'reset'
  | 'fit'
  | 'auto-fit'
  | 'board-view'
  | 'deck-view'
  | 'tile'
  | 'clear'
  | 'close'
  | 'search'
  | 'pending'
  | 'help'
  | 'undo'
  | 'skip'
  | 'check'
  | 'mode-grab'
  | 'mode-pan'
  | 'mode-inspect';

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

/**
 * Help. A centered circle with a question hook, authored on the 24-unit grid with no fill.
 */
export function IconHelp(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2 2-2 3" />
      <path d="M12 16.5v.5" />
    </Svg>
  );
}

/** Drag & grab mode — a card plate with an active cursor arrow picking it up. */
export function IconModeGrab(props: IconProps) {
  return (
    <Svg {...props}>
      <rect height="13" rx="1.5" width="11" x="3.5" y="3.5" />
      <path d="M6.5 7.5h5M6.5 10.5h3" />
      <path d="M13 12.5l7.5 3-3.2 1.4-1.4 3.2-2.9-7.6z" />
    </Svg>
  );
}

/** Just drag (pan only) mode — four-axis compass arrows moving the board plane. */
export function IconModePan(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3v18M3 12h18M9.5 5.5 12 3l2.5 2.5M9.5 18.5 12 21l2.5-2.5M5.5 9.5 3 12l2.5 2.5M18.5 9.5 21 12l-2.5 2.5" />
    </Svg>
  );
}

/** Drag & inspect mode — a card plate with a magnifier lens reading its title. */
export function IconModeInspect(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14.5 10V5.5a1.5 1.5 0 0 0-1.5-1.5H5a1.5 1.5 0 0 0-1.5 1.5v11A1.5 1.5 0 0 0 5 18h4.5" />
      <path d="M6.5 8h5.5M6.5 11.5h3.5" />
      <circle cx="16" cy="15.5" r="3.5" />
      <path d="M18.6 18.1 21 20.5" />
    </Svg>
  );
}

/** Infinite board view — a 2x2 grid representing whiteboard canvas. */
export function IconBoardView(props: IconProps) {
  return (
    <Svg {...props}>
      <rect height="7" rx="1" width="7" x="3.5" y="3.5" />
      <rect height="7" rx="1" width="7" x="13.5" y="3.5" />
      <rect height="7" rx="1" width="7" x="3.5" y="13.5" />
      <rect height="7" rx="1" width="7" x="13.5" y="13.5" />
    </Svg>
  );
}

/** Deck view — layered stacked cards. */
export function IconDeckView(props: IconProps) {
  return (
    <Svg {...props}>
      <rect height="13" rx="1.5" width="11" x="7.5" y="6.5" />
      <path d="M4.5 16.5v-10A1.5 1.5 0 0 1 6 5h10" />
    </Svg>
  );
}

/** Undo action — counter-clockwise curved arrow. */
export function IconUndo(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 9h9a5.5 5.5 0 1 1 0 11H9" />
      <path d="m6.5 12-3-3 3-3" />
    </Svg>
  );
}

/** Skip to back — forward arrow with vertical line. */
export function IconSkip(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 5l8 7-8 7V5zM17 5v14" />
    </Svg>
  );
}

/** Quick dock / confirm — clean checkmark. */
export function IconCheck(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 12.5l5 5 10-11" />
    </Svg>
  );
}

/** Kept as a lookup so a control can declare an icon by name instead of by element. */
export const ICONS = {
  'auto-fit': IconAutoFit,
  'board-view': IconBoardView,
  check: IconCheck,
  clear: IconClear,
  close: IconClose,
  'deck-view': IconDeckView,
  fit: IconFit,
  help: IconHelp,
  'mode-grab': IconModeGrab,
  'mode-inspect': IconModeInspect,
  'mode-pan': IconModePan,
  pending: IconPending,
  reset: IconReset,
  search: IconSearch,
  skip: IconSkip,
  tile: IconTile,
  undo: IconUndo,
  'zoom-in': IconZoomIn,
  'zoom-out': IconZoomOut,
} satisfies Record<IconName, (props: IconProps) => React.ReactElement>;
