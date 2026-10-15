import {
  AUTO_FIT_ACTIVE_LABEL,
  AUTO_FIT_DESCRIPTION,
  AUTO_FIT_INACTIVE_LABEL,
  AUTO_FIT_LABEL,
  AUTO_FIT_TOGGLE_OFF,
  AUTO_FIT_TOGGLE_ON,
  AUTO_TILE_LABEL,
  AUTO_TILE_TOOLTIP,
  BOARD_TOOLBAR_LABEL,
  CLEAR_BOARD_LABEL,
  CLEAR_BOARD_TOOLTIP,
  FIT_VIEW_LABEL,
  HELP_LABEL,
  HELP_TOOLTIP,
  RESET_ZOOM_LABEL,
  ZOOM_CONTROL_LABEL,
  ZOOM_IN_LABEL,
  ZOOM_OUT_LABEL,
  resetZoomLabel,
  zoomPercentage,
  zoomReadout,
} from './copy';
import { IconAutoFit, IconClear, IconFit, IconHelp, IconTile, IconZoomIn, IconZoomOut } from './icons';

type GlyphComponent = (props: { className?: string }) => React.ReactElement;

export type BoardActionItem = {
  id: string;
  label: string;
  ariaLabel?: string;
  tooltip?: string;
  icon?: GlyphComponent;
  shortcut?: string;
  disabled?: boolean;
  isToggle?: boolean;
  isPressed?: boolean;
  variant?: 'default' | 'danger' | 'toggle';
  onClick: () => void;
};

export type BoardToolbarProps = {
  scale: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  canResetZoom: boolean;
  canFitContent: boolean;
  canAutoTile?: boolean;
  canClearBoard: boolean;
  autoFitEnabled: boolean;
  isDragging?: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onFitContent: () => void;
  onAutoTile?: () => void;
  onToggleAutoFit: (enabled: boolean) => void;
  onClearBoard: () => void;
  onOpenHelp?: () => void;
  extraActions?: BoardActionItem[];
};

/**
 * The board rail.
 *
 * Icon-only, with the text label revealed on hover **and** on focus. The label is a sibling
 * element rather than a `title` attribute, because a native tooltip is mouse-only — and a
 * keyboard user driving a canvas needs to know what `0`, `1` and `T` do at least as much as a
 * mouse user does. Every control keeps its real accessible name in `aria-label`; the revealed
 * label is decoration on top of that name, never the name itself.
 *
 * Three things here are deliberate:
 *
 * - **The zoom readout is the reset control.** "You are at 40%" and "click here for 100%" are
 *   one statement, and a 40px rail has room for one of them. The visible number is
 *   `aria-hidden`; a separate `aria-live` region announces the long form, so a screen-reader
 *   user hears "Zoom: 40%" rather than a bare figure.
 * - **Auto-fit is a switch, not a button.** It is the only control with two states, so it is
 *   the only one that carries a lamp — and the lamp is what a 16px icon cannot say on its own.
 * - **The rail is narrow.** The previous text stack ate a full column of the viewport for six
 *   controls. At `--rail-width` the board gets that column back.
 */
export function BoardToolbar({
  scale,
  canZoomIn,
  canZoomOut,
  canResetZoom,
  canFitContent,
  canAutoTile = true,
  canClearBoard,
  autoFitEnabled,
  isDragging = false,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onFitContent,
  onAutoTile,
  onToggleAutoFit,
  onClearBoard,
  onOpenHelp,
  extraActions = [],
}: BoardToolbarProps) {
  const actions: BoardActionItem[] = [
    {
      id: 'fit-content',
      label: FIT_VIEW_LABEL,
      ariaLabel: FIT_VIEW_LABEL,
      tooltip: `${FIT_VIEW_LABEL} (0)`,
      icon: IconFit,
      shortcut: '0',
      onClick: onFitContent,
      disabled: !canFitContent,
      variant: 'default',
    },
    ...(onAutoTile
      ? [
          {
            id: 'auto-tile',
            label: AUTO_TILE_LABEL,
            ariaLabel: AUTO_TILE_LABEL,
            tooltip: `${AUTO_TILE_TOOLTIP} (T)`,
            icon: IconTile,
            shortcut: 'T',
            onClick: onAutoTile,
            disabled: !canAutoTile,
            variant: 'default' as const,
          },
        ]
      : []),
    ...extraActions,
    {
      id: 'auto-fit',
      label: AUTO_FIT_LABEL,
      ariaLabel: autoFitEnabled ? AUTO_FIT_ACTIVE_LABEL : AUTO_FIT_INACTIVE_LABEL,
      tooltip: AUTO_FIT_DESCRIPTION,
      icon: IconAutoFit,
      onClick: () => onToggleAutoFit(!autoFitEnabled),
      isToggle: true,
      isPressed: autoFitEnabled,
      variant: 'toggle',
    },
    {
      id: 'help',
      label: HELP_LABEL,
      ariaLabel: HELP_LABEL,
      tooltip: `${HELP_TOOLTIP} (?)`,
      icon: IconHelp,
      shortcut: '?',
      onClick: () => onOpenHelp?.(),
      variant: 'default',
    },
    {
      id: 'clear-board',
      label: CLEAR_BOARD_LABEL,
      ariaLabel: CLEAR_BOARD_LABEL,
      tooltip: CLEAR_BOARD_TOOLTIP,
      icon: IconClear,
      onClick: onClearBoard,
      disabled: !canClearBoard,
      variant: 'danger',
    },
  ];

  return (
    <aside
      aria-label={BOARD_TOOLBAR_LABEL}
      className={`board-toolbar${isDragging ? ' board-toolbar--inert' : ''}`}
      data-tour-anchor="toolbar"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div aria-label={ZOOM_CONTROL_LABEL} className="board-toolbar__group" role="group">
        <div className="board-toolbar__item">
          <button
            aria-label={ZOOM_OUT_LABEL}
            className="btn btn--sm btn--icon board-toolbar__btn"
            disabled={!canZoomOut}
            onClick={onZoomOut}
            type="button"
          >
            <IconZoomOut />
          </button>
          <span aria-hidden="true" className="board-toolbar__label">
            {ZOOM_OUT_LABEL}
          </span>
        </div>

        <output aria-live="polite" className="sr-only">
          {zoomPercentage(scale)}
        </output>
        <button
          aria-label={canResetZoom ? resetZoomLabel(scale) : RESET_ZOOM_LABEL}
          className="board-toolbar__readout"
          disabled={!canResetZoom}
          onClick={onResetZoom}
          type="button"
        >
          <span aria-hidden="true">{zoomReadout(scale)}</span>
        </button>

        <div className="board-toolbar__item">
          <button
            aria-label={ZOOM_IN_LABEL}
            className="btn btn--sm btn--icon board-toolbar__btn"
            disabled={!canZoomIn}
            onClick={onZoomIn}
            type="button"
          >
            <IconZoomIn />
          </button>
          <span aria-hidden="true" className="board-toolbar__label">
            {ZOOM_IN_LABEL}
          </span>
        </div>

        {/* The one structural rule, doing its fifth job: the separator between two groups of
            controls, drawn the same as every other divider in the app. */}
        <div aria-hidden="true" className="board-toolbar__divider" />

        {actions.map((action) => {
          if (action.variant === 'toggle') {
            const stateLabel = action.isPressed ? AUTO_FIT_TOGGLE_ON : AUTO_FIT_TOGGLE_OFF;

            return (
              <div className="board-toolbar__item" key={action.id}>
                <button
                  aria-checked={action.isPressed}
                  aria-describedby="autofit-description"
                  aria-label={action.ariaLabel ?? action.label}
                  className={`btn btn--sm btn--icon board-toolbar__btn board-toolbar__btn--toggle${action.isPressed ? ' board-toolbar__btn--on' : ''}`}
                  id="autofit-toggle"
                  onClick={action.onClick}
                  role="switch"
                  type="button"
                >
                  {action.icon ? <action.icon /> : null}
                  <span aria-hidden="true" className="board-toolbar__lamp" />
                </button>
                {/* aria-hidden: the switch is already named by its own aria-label, and this
                    text is the pointer affordance. The always-available description lives in
                    the sr-only node below, which `aria-describedby` points at — a `visibility:
                    hidden` tooltip is not reliably read out. */}
                <span aria-hidden="true" className="board-toolbar__label">
                  {action.label}: {stateLabel} — {action.tooltip}
                </span>
                <span className="sr-only" id="autofit-description">
                  {action.tooltip}
                </span>
              </div>
            );
          }

          const Glyph = action.icon ?? IconFit;

          return (
            <div className="board-toolbar__item" key={action.id}>
              <button
                aria-label={action.ariaLabel ?? action.label}
                className={`btn btn--sm btn--icon board-toolbar__btn${action.variant === 'danger' ? ' board-toolbar__btn--danger' : ''}`}
                disabled={action.disabled}
                onClick={action.onClick}
                type="button"
              >
                <Glyph />
              </button>
              <span aria-hidden="true" className="board-toolbar__label">
                {action.tooltip ?? action.label}
              </span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
