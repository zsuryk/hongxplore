import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import agentResponse from '../../docs/examples/agent-response.json';
import { AgentStatusPanel } from './AgentStatusPanel';
import type { components } from './api/schema';
import {
  AGENT_LOG_CLOSE,
  AGENT_LOG_LABEL,
  AGENT_STATUS_ERROR,
  AGENT_STATUS_IDLE,
  AGENT_STATUS_SEARCHING,
  DATA_SOURCE_LIVE,
  DATA_SOURCE_MOCK,
  agentStatusResults,
  formatLogTimestamp,
} from './copy';
import { useBoardStore } from './state/boardStore';

const response = agentResponse as components['schemas']['AgentResponse'];

describe('AgentStatusPanel', () => {
  it('renders idle status', () => {
    const markup = renderToStaticMarkup(<AgentStatusPanel status="idle" />);

    expect(markup).toContain(AGENT_STATUS_IDLE);
    expect(markup).toContain('agent-status-dot--idle');
  });

  it('renders searching status', () => {
    const markup = renderToStaticMarkup(<AgentStatusPanel status="searching" />);

    expect(markup).toContain(AGENT_STATUS_SEARCHING);
    expect(markup).toContain('agent-status-dot--searching');
  });

  it('renders results count', () => {
    const markup = renderToStaticMarkup(<AgentStatusPanel cards={response.matches} status="results" />);

    expect(markup).toContain(agentStatusResults(response.matches.length));
    expect(markup).toContain('agent-status-dot--results');
  });

  it('renders error state with copy', () => {
    const markup = renderToStaticMarkup(<AgentStatusPanel status="error" />);

    expect(markup).toContain(AGENT_STATUS_ERROR);
    expect(markup).toContain('agent-status-dot--error');
  });

  it('formats log timestamps in HKT', () => {
    const iso = '2026-10-04T06:00:00Z';
    const formatted = formatLogTimestamp(iso);
    expect(formatted).toBe('14:00:00');
  });
});

describe('AgentStatusPanel — data source mode toggle (#126)', () => {
  beforeEach(() => {
    useBoardStore.setState({
      agentError: null,
      agentLog: [],
      agentStatus: 'idle',
      cards: [],
      dataSourceMode: 'live',
    });
  });

  it('does not invoke loadAgentResponse inside handleModeSwitch while keeping handleUseDemo intact', () => {
    const panelSource = readFileSync(join(import.meta.dirname, 'AgentStatusPanel.tsx'), 'utf8');
    const modeSwitchBody = panelSource.match(/function handleModeSwitch\([^)]*\)\s*\{([^}]*)\}/)?.[1] ?? '';
    const useDemoBody = panelSource.match(/function handleUseDemo\([^)]*\)\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(modeSwitchBody).toContain('setDataSourceMode(mode)');
    expect(modeSwitchBody).not.toContain('loadAgentResponse');
    expect(useDemoBody).toContain("setDataSourceMode('mock')");
    expect(useDemoBody).toContain('loadAgentResponse');
  });

  it('switches data source mode to mock without generating cards and reflects active button state', () => {
    useBoardStore.getState().setDataSourceMode('mock');

    expect(useBoardStore.getState().dataSourceMode).toBe('mock');
    expect(useBoardStore.getState().cards).toHaveLength(0);

    const markup = renderToStaticMarkup(<AgentStatusPanel dataSourceMode="mock" />);
    expect(markup).toContain(
      `aria-pressed="true" class="segmented__option segmented__option--active" type="button">${DATA_SOURCE_MOCK}`,
    );
    expect(markup).toContain(`aria-pressed="false" class="segmented__option" type="button">${DATA_SOURCE_LIVE}`);
  });

  it('preserves existing board cards unchanged when toggling between live and mock modes', () => {
    useBoardStore.setState({
      cards: [response.matches[0]],
      dataSourceMode: 'live',
    });

    useBoardStore.getState().setDataSourceMode('mock');
    expect(useBoardStore.getState().dataSourceMode).toBe('mock');
    expect(useBoardStore.getState().cards).toEqual([response.matches[0]]);

    useBoardStore.getState().setDataSourceMode('live');
    expect(useBoardStore.getState().dataSourceMode).toBe('live');
    expect(useBoardStore.getState().cards).toEqual([response.matches[0]]);
  });
});

/**
 * The agent log is a floating popover, not a panel section.
 *
 * It used to be a `div` in the panel's normal flow, so opening it stole 98px of board height and
 * pushed every card on the board down by the same amount. `popover="auto"` fixes that structurally:
 * the element is promoted to the top layer, where it is out of flow and no ancestor can reflow
 * around it, and the browser supplies light dismiss, Escape and focus return.
 *
 * Focus *behaviour* is verified in a real browser rather than here — this runner has no DOM, so
 * there is nothing to focus (see the PR description for the measured Escape/close-button results).
 * What is asserted here is the contract that makes that behaviour possible and correct.
 */
describe('AgentStatusPanel — agent log popover', () => {
  // The trigger only renders once there is a log to show, so these cases need a populated one.
  const withLog = renderToStaticMarkup(<AgentStatusPanel log={response.log} status="results" />);

  it('renders the log as a native auto popover, so it cannot reflow the board', () => {
    expect(withLog).toContain('popover="auto"');
  });

  it('is non-modal: it declares no aria-modal and traps no focus', () => {
    // `aria-modal` on a surface that is not modal tells assistive tech to hide everything outside
    // it and to keep focus inside — the opposite of what a popover does. Its absence is the
    // contract; asserting `not.toContain('aria-modal')` keeps a future "just make it a dialog"
    // change from shipping silently.
    expect(withLog).not.toContain('aria-modal');
  });

  it('wires the trigger to the popover with aria-expanded and aria-controls', () => {
    expect(withLog).toMatch(/aria-expanded="(true|false)"/);
    expect(withLog).toContain('aria-controls="agent-log-popover"');
    expect(withLog).toContain('id="agent-log-popover"');
  });

  it('keeps role="log" on the scrolling body, not on the popover surface', () => {
    // A live region that also contains the popover's own heading would read the title out as a
    // newly recorded agent step, which is exactly the kind of thing that teaches people to mute
    // live regions.
    expect(withLog).toContain('role="log"');
    const logIndex = withLog.indexOf('role="log"');
    const titleIndex = withLog.indexOf(AGENT_LOG_LABEL);
    expect(logIndex).toBeGreaterThan(titleIndex);
  });

  it('gives the log a labelled surface and a named close control', () => {
    expect(withLog).toContain(`aria-label="${AGENT_LOG_LABEL}"`);
    // Escape and an outside click both close it, but a touch user has no Escape key, and a
    // dismissable surface with no visible way out reads as stuck.
    expect(withLog).toContain(`aria-label="${AGENT_LOG_CLOSE}"`);
  });

  it("is not one of the panel header's in-flow children", () => {
    // The log is a sibling of the header row rather than a child of it: it escaped the strip's
    // box, which is what "floating" means here. It is still a child of the panel, which is what
    // ADR-0009 requires — chrome stays outside `.board__pan`.
    expect(withLog).toContain('class="agent-status-panel__header"');
    expect(withLog).toContain('class="agent-log"');
    expect(withLog).not.toContain('class="agent-status-panel__log"');
  });
});
