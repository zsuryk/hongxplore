import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BoardToolbar } from './BoardToolbar';
import {
  AUTO_FIT_ACTIVE_LABEL,
  AUTO_FIT_DESCRIPTION,
  AUTO_FIT_INACTIVE_LABEL,
  AUTO_FIT_LABEL,
  AUTO_TILE_LABEL,
  AUTO_TILE_TOOLTIP,
  BOARD_TOOLBAR_LABEL,
  CLEAR_BOARD_LABEL,
  FIT_VIEW_LABEL,
  RESET_ZOOM_LABEL,
  ZOOM_IN_LABEL,
  ZOOM_OUT_LABEL,
} from './copy';

describe('BoardToolbar', () => {
  const defaultProps = {
    scale: 1,
    canZoomIn: true,
    canZoomOut: true,
    canResetZoom: false,
    canFitContent: true,
    canClearBoard: true,
    autoFitEnabled: true,
    isDragging: false,
    onZoomIn: () => undefined,
    onZoomOut: () => undefined,
    onResetZoom: () => undefined,
    onFitContent: () => undefined,
    onToggleAutoFit: () => undefined,
    onClearBoard: () => undefined,
  };

  it('renders all board actions with accessible names and live zoom readout', () => {
    const markup = renderToStaticMarkup(<BoardToolbar {...defaultProps} />);

    expect(markup).toContain(`aria-label="${BOARD_TOOLBAR_LABEL}"`);
    expect(markup).toContain(`aria-label="${ZOOM_OUT_LABEL}"`);
    expect(markup).toContain(`aria-label="${ZOOM_IN_LABEL}"`);
    expect(markup).toContain(`aria-label="${RESET_ZOOM_LABEL}"`);
    expect(markup).toContain(`aria-label="${FIT_VIEW_LABEL}"`);
    expect(markup).toContain(`aria-label="${AUTO_FIT_ACTIVE_LABEL}"`);
    expect(markup).toContain(`aria-label="${CLEAR_BOARD_LABEL}"`);
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('Zoom: 100%');
  });

  it('reflects disabled states for zoom, fit, and clear actions accurately', () => {
    const markup = renderToStaticMarkup(
      <BoardToolbar
        {...defaultProps}
        canClearBoard={false}
        canFitContent={false}
        canResetZoom={false}
        canZoomIn={false}
        canZoomOut={false}
      />,
    );

    expect(markup).toContain(`<button aria-label="${ZOOM_OUT_LABEL}" class="btn btn--sm btn--icon" disabled=""`);
    expect(markup).toContain(`<button aria-label="${ZOOM_IN_LABEL}" class="btn btn--sm btn--icon" disabled=""`);
    expect(markup).toContain(`<button aria-label="${RESET_ZOOM_LABEL}" class="btn btn--sm" disabled=""`);
    expect(markup).toContain(`<button aria-label="${FIT_VIEW_LABEL}" class="btn btn--sm" disabled=""`);
    expect(markup).toContain(
      `<button aria-label="${CLEAR_BOARD_LABEL}" class="btn btn--sm btn--danger board-toolbar__btn--danger" disabled=""`,
    );
  });

  it('renders enabled states when actions are valid', () => {
    const markup = renderToStaticMarkup(
      <BoardToolbar
        {...defaultProps}
        canClearBoard={true}
        canFitContent={true}
        canResetZoom={true}
        canZoomIn={true}
        canZoomOut={true}
      />,
    );

    expect(markup).toContain(`<button aria-label="${RESET_ZOOM_LABEL}" class="btn btn--sm"`);
    expect(markup).not.toContain(`<button aria-label="${RESET_ZOOM_LABEL}" class="btn btn--sm" disabled=""`);
    expect(markup).not.toContain(
      `<button aria-label="${CLEAR_BOARD_LABEL}" class="btn btn--sm btn--danger board-toolbar__btn--danger" disabled=""`,
    );
  });

  it('renders auto-fit toggle with visible on/off state and accessible tooltip', () => {
    const onMarkup = renderToStaticMarkup(<BoardToolbar {...defaultProps} autoFitEnabled={true} />);

    expect(onMarkup).toContain('role="switch"');
    expect(onMarkup).toContain('aria-checked="true"');
    expect(onMarkup).toContain(`aria-label="${AUTO_FIT_ACTIVE_LABEL}"`);
    expect(onMarkup).toContain(AUTO_FIT_LABEL);
    expect(onMarkup).toContain('board-toolbar__toggle--active');
    expect(onMarkup).toContain('On');
    expect(onMarkup).toContain(AUTO_FIT_DESCRIPTION);
    expect(onMarkup).toContain('aria-describedby="autofit-description"');
    expect(onMarkup).toContain('id="autofit-description"');

    const offMarkup = renderToStaticMarkup(<BoardToolbar {...defaultProps} autoFitEnabled={false} />);
    expect(offMarkup).toContain('aria-checked="false"');
    expect(offMarkup).toContain(`aria-label="${AUTO_FIT_INACTIVE_LABEL}"`);
    expect(offMarkup).not.toContain('board-toolbar__toggle--active');
    expect(offMarkup).toContain('Off');
  });

  it('applies inert styling during active card drag to avoid event interception', () => {
    const idleMarkup = renderToStaticMarkup(<BoardToolbar {...defaultProps} isDragging={false} />);
    expect(idleMarkup).not.toContain('board-toolbar--inert');

    const dragMarkup = renderToStaticMarkup(<BoardToolbar {...defaultProps} isDragging={true} />);
    expect(dragMarkup).toContain('board-toolbar--inert');
  });

  it('renders extra actions seamlessly for future auto-tile support', () => {
    const markup = renderToStaticMarkup(
      <BoardToolbar
        {...defaultProps}
        extraActions={[
          {
            id: 'auto-tile',
            label: 'Auto-tile',
            onClick: () => undefined,
          },
        ]}
      />,
    );

    expect(markup).toContain('Auto-tile');
  });

  it('renders auto-tile button with accessible label and responds to canAutoTile state', () => {
    const enabledMarkup = renderToStaticMarkup(
      <BoardToolbar {...defaultProps} canAutoTile={true} onAutoTile={() => undefined} />,
    );
    expect(enabledMarkup).toContain(`aria-label="${AUTO_TILE_LABEL}"`);
    expect(enabledMarkup).toContain(AUTO_TILE_LABEL);
    expect(enabledMarkup).toContain(AUTO_TILE_TOOLTIP);
    expect(enabledMarkup).not.toContain(`<button aria-label="${AUTO_TILE_LABEL}" class="btn btn--sm" disabled=""`);

    const disabledMarkup = renderToStaticMarkup(
      <BoardToolbar {...defaultProps} canAutoTile={false} onAutoTile={() => undefined} />,
    );
    expect(disabledMarkup).toContain(`<button aria-label="${AUTO_TILE_LABEL}" class="btn btn--sm" disabled=""`);
  });
});
