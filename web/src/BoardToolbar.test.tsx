import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BoardToolbar } from './BoardToolbar';
import {
  AUTO_FIT_ACTIVE_LABEL,
  AUTO_FIT_DESCRIPTION,
  AUTO_FIT_INACTIVE_LABEL,
  AUTO_FIT_LABEL,
  AUTO_FIT_TOGGLE_ON,
  AUTO_TILE_LABEL,
  AUTO_TILE_TOOLTIP,
  BOARD_TOOLBAR_LABEL,
  CLEAR_BOARD_LABEL,
  CLEAR_BOARD_TOOLTIP,
  FIT_VIEW_LABEL,
  RESET_ZOOM_LABEL,
  ZOOM_IN_LABEL,
  ZOOM_OUT_LABEL,
  zoomPercentage,
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

    // Every rail control is an icon button, so the class list carries `btn--icon` and the
    // rail's own `board-toolbar__btn`. The clear control keeps its `btn--danger` variant so
    // the one destructive action in the rail is still identifiable in the markup.
    expect(markup).toContain(
      `<button aria-label="${ZOOM_OUT_LABEL}" class="btn btn--sm btn--icon board-toolbar__btn" disabled=""`,
    );
    expect(markup).toContain(
      `<button aria-label="${ZOOM_IN_LABEL}" class="btn btn--sm btn--icon board-toolbar__btn" disabled=""`,
    );
    expect(markup).toContain(`<button aria-label="${RESET_ZOOM_LABEL}" class="board-toolbar__readout" disabled=""`);
    expect(markup).toContain(
      `<button aria-label="${FIT_VIEW_LABEL}" class="btn btn--sm btn--icon board-toolbar__btn" disabled=""`,
    );
    expect(markup).toContain(
      `<button aria-label="${CLEAR_BOARD_LABEL}" class="btn btn--sm btn--icon board-toolbar__btn board-toolbar__btn--danger" disabled=""`,
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

    expect(markup).toContain(`<button aria-label="${RESET_ZOOM_LABEL}`);
    expect(markup).toContain('class="board-toolbar__readout" type="button"');
    expect(markup).not.toContain('class="board-toolbar__readout" disabled=""');
    expect(markup).not.toContain(
      `<button aria-label="${CLEAR_BOARD_LABEL}" class="btn btn--sm btn--icon board-toolbar__btn board-toolbar__btn--danger" disabled=""`,
    );
  });

  it('is an icon rail: every control is icon-only and its label is revealed, not rendered', () => {
    const markup = renderToStaticMarkup(<BoardToolbar {...defaultProps} onAutoTile={() => undefined} />);

    // Six controls, six inline glyphs — no text label is painted into a button, and no
    // `title` attribute is used, because a native tooltip is mouse-only. The readout/reset
    // is the seventh control and is deliberately glyph-free: the number is its label.
    expect([...markup.matchAll(/<svg aria-hidden="true" class="icon"/g)]).toHaveLength(6);
    expect(markup).not.toContain('title=');

    // Each revealed label is `aria-hidden`: it is a pointer affordance sitting on top of a
    // control that already has a real accessible name, never the name itself.
    const labels = [...markup.matchAll(/<span aria-hidden="true" class="board-toolbar__label">([^<]*)</g)];
    expect(labels.map((match) => match[1])).toEqual([
      ZOOM_OUT_LABEL,
      ZOOM_IN_LABEL,
      `${FIT_VIEW_LABEL} (0)`,
      `${AUTO_TILE_TOOLTIP} (T)`,
      `${AUTO_FIT_LABEL}: ${AUTO_FIT_TOGGLE_ON} — ${AUTO_FIT_DESCRIPTION}`,
      CLEAR_BOARD_TOOLTIP,
    ]);
  });

  it('doubles the zoom readout as the reset control and announces the long form politely', () => {
    const markup = renderToStaticMarkup(<BoardToolbar {...defaultProps} scale={0.8} canResetZoom={true} />);

    // What you see is the bare number; what is announced is the number with its subject. The
    // visible string is aria-hidden so the two never disagree.
    expect(markup).toContain('<span aria-hidden="true">80%</span>');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('Zoom: 80%');
    // Clicking the readout resets, and says so.
    expect(markup).toContain(`aria-label="${RESET_ZOOM_LABEL} — ${zoomPercentage(0.8)}"`);
  });

  it('renders auto-fit toggle with visible on/off state and accessible tooltip', () => {
    const onMarkup = renderToStaticMarkup(<BoardToolbar {...defaultProps} autoFitEnabled={true} />);

    expect(onMarkup).toContain('role="switch"');
    expect(onMarkup).toContain('aria-checked="true"');
    expect(onMarkup).toContain(`aria-label="${AUTO_FIT_ACTIVE_LABEL}"`);
    expect(onMarkup).toContain(AUTO_FIT_LABEL);
    expect(onMarkup).toContain('board-toolbar__btn--on');
    expect(onMarkup).toContain('On');
    expect(onMarkup).toContain(AUTO_FIT_DESCRIPTION);
    expect(onMarkup).toContain('aria-describedby="autofit-description"');
    expect(onMarkup).toContain('id="autofit-description"');

    const offMarkup = renderToStaticMarkup(<BoardToolbar {...defaultProps} autoFitEnabled={false} />);
    expect(offMarkup).toContain('aria-checked="false"');
    expect(offMarkup).toContain(`aria-label="${AUTO_FIT_INACTIVE_LABEL}"`);
    expect(offMarkup).not.toContain('board-toolbar__btn--on');
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
    expect(enabledMarkup).not.toContain(
      `<button aria-label="${AUTO_TILE_LABEL}" class="btn btn--sm btn--icon board-toolbar__btn" disabled=""`,
    );

    const disabledMarkup = renderToStaticMarkup(
      <BoardToolbar {...defaultProps} canAutoTile={false} onAutoTile={() => undefined} />,
    );
    expect(disabledMarkup).toContain(
      `<button aria-label="${AUTO_TILE_LABEL}" class="btn btn--sm btn--icon board-toolbar__btn" disabled=""`,
    );
  });
});
