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
  RESET_ZOOM_LABEL,
  ZOOM_CONTROL_LABEL,
  ZOOM_IN_LABEL,
  ZOOM_OUT_LABEL,
  zoomPercentage,
} from './copy';

export type BoardActionItem = {
  id: string;
  label: string;
  ariaLabel?: string;
  tooltip?: string;
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
  extraActions?: BoardActionItem[];
};

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
  extraActions = [],
}: BoardToolbarProps) {
  const actions: BoardActionItem[] = [
    {
      id: 'fit-content',
      label: FIT_VIEW_LABEL,
      ariaLabel: FIT_VIEW_LABEL,
      tooltip: `${FIT_VIEW_LABEL} (0)`,
      shortcut: '0',
      onClick: onFitContent,
      disabled: !canFitContent,
      variant: 'default',
    },
    {
      id: 'auto-fit',
      label: AUTO_FIT_LABEL,
      ariaLabel: autoFitEnabled ? AUTO_FIT_ACTIVE_LABEL : AUTO_FIT_INACTIVE_LABEL,
      tooltip: AUTO_FIT_DESCRIPTION,
      onClick: () => onToggleAutoFit(!autoFitEnabled),
      isToggle: true,
      isPressed: autoFitEnabled,
      variant: 'toggle',
    },
    ...(onAutoTile
      ? [
          {
            id: 'auto-tile',
            label: AUTO_TILE_LABEL,
            ariaLabel: AUTO_TILE_LABEL,
            tooltip: `${AUTO_TILE_TOOLTIP} (T)`,
            shortcut: 'T',
            onClick: onAutoTile,
            disabled: !canAutoTile,
            variant: 'default' as const,
          },
        ]
      : []),
    ...extraActions,
    {
      id: 'clear-board',
      label: CLEAR_BOARD_LABEL,
      ariaLabel: CLEAR_BOARD_LABEL,
      tooltip: CLEAR_BOARD_TOOLTIP,
      onClick: onClearBoard,
      disabled: !canClearBoard,
      variant: 'danger',
    },
  ];

  return (
    <aside
      aria-label={BOARD_TOOLBAR_LABEL}
      className={`board-toolbar${isDragging ? ' board-toolbar--inert' : ''}`}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div aria-label={ZOOM_CONTROL_LABEL} className="board-toolbar__group board-toolbar__group--zoom" role="group">
        <div className="board-toolbar__item">
          <button
            aria-label={ZOOM_OUT_LABEL}
            className="btn btn--sm btn--icon"
            disabled={!canZoomOut}
            onClick={onZoomOut}
            type="button"
          >
            &minus;
          </button>
        </div>
        <output aria-live="polite" className="board-toolbar__readout">
          {zoomPercentage(scale)}
        </output>
        <div className="board-toolbar__item">
          <button
            aria-label={ZOOM_IN_LABEL}
            className="btn btn--sm btn--icon"
            disabled={!canZoomIn}
            onClick={onZoomIn}
            type="button"
          >
            +
          </button>
        </div>
        <div className="board-toolbar__item">
          <button
            aria-label={RESET_ZOOM_LABEL}
            className="btn btn--sm"
            disabled={!canResetZoom}
            onClick={onResetZoom}
            type="button"
          >
            100%
          </button>
        </div>
      </div>

      <div aria-hidden="true" className="board-toolbar__divider" />

      <div aria-label={BOARD_TOOLBAR_LABEL} className="board-toolbar__group board-toolbar__group--actions" role="group">
        {actions.map((action) => {
          if (action.variant === 'toggle') {
            return (
              <div className="board-toolbar__item board-toolbar__item--toggle" key={action.id}>
                <button
                  aria-checked={action.isPressed}
                  aria-describedby="autofit-description"
                  aria-label={action.ariaLabel ?? action.label}
                  className={`btn btn--sm board-toolbar__toggle${action.isPressed ? ' board-toolbar__toggle--active' : ''}`}
                  id="autofit-toggle"
                  onClick={action.onClick}
                  role="switch"
                  type="button"
                >
                  <span aria-hidden="true" className="board-toolbar__toggle-indicator" />
                  <span className="board-toolbar__toggle-label">{action.label}</span>
                  <span aria-hidden="true" className="board-toolbar__toggle-badge">
                    {action.isPressed ? AUTO_FIT_TOGGLE_ON : AUTO_FIT_TOGGLE_OFF}
                  </span>
                </button>
                {action.tooltip ? (
                  <span className="board-toolbar__tooltip" id="autofit-description" role="tooltip">
                    {action.tooltip}
                  </span>
                ) : null}
              </div>
            );
          }

          if (action.variant === 'danger') {
            return (
              <div className="board-toolbar__item" key={action.id}>
                <button
                  aria-label={action.ariaLabel ?? action.label}
                  className="btn btn--sm btn--danger board-toolbar__btn--danger"
                  disabled={action.disabled}
                  onClick={action.onClick}
                  title={action.tooltip}
                  type="button"
                >
                  {action.label}
                </button>
                {action.tooltip ? (
                  <span className="board-toolbar__tooltip" role="tooltip">
                    {action.tooltip}
                  </span>
                ) : null}
              </div>
            );
          }

          return (
            <div className="board-toolbar__item" key={action.id}>
              <button
                aria-label={action.ariaLabel ?? action.label}
                className="btn btn--sm"
                disabled={action.disabled}
                onClick={action.onClick}
                title={action.tooltip}
                type="button"
              >
                {action.label}
              </button>
              {action.tooltip ? (
                <span className="board-toolbar__tooltip" role="tooltip">
                  {action.tooltip}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
