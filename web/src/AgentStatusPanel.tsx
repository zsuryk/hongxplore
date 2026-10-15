import { useEffect, useRef, useState } from 'react';
import { fixtureAgentClient } from './api/client';
import { IconClose } from './icons';
import {
  AGENT_LOG_CLOSE,
  AGENT_LOG_EMPTY,
  AGENT_LOG_HIDE,
  AGENT_LOG_LABEL,
  AGENT_LOG_SHOW,
  AGENT_STATUS_ERROR,
  AGENT_STATUS_IDLE,
  AGENT_STATUS_SEARCHING,
  AGENT_STATUS_TITLE,
  AGENT_USE_DEMO,
  DATA_SOURCE_LABEL,
  DATA_SOURCE_LIVE,
  DATA_SOURCE_MOCK,
  agentStatusResults,
  formatLogTimestamp,
  INITIAL_ACTIVITY_QUERY,
} from './copy';
import {
  type ActivityCard,
  type AgentLogEntry,
  type AgentStatus,
  type DataSourceMode,
  useBoardStore,
} from './state/boardStore';

export type AgentStatusPanelProps = {
  status?: AgentStatus;
  error?: string | null;
  log?: AgentLogEntry[];
  cards?: ActivityCard[];
  initialExpanded?: boolean;
};

/** The popover and the button that anchors it are wired together by id, not by ref. */
const AGENT_LOG_POPOVER_ID = 'agent-log-popover';

/** Is the native Popover API available? Everything below degrades to an inline disclosure if not,
 *  because a browser without `popover` also has no UA rule to hide the element — it simply
 *  renders where it sits, which is exactly the old behaviour. */
function canUsePopover(element: HTMLElement | null): boolean {
  return element !== null && typeof element.showPopover === 'function';
}

export function AgentStatusPanel({
  status: propStatus,
  error: propError,
  log: propLog,
  cards: propCards,
  initialExpanded = false,
}: AgentStatusPanelProps = {}) {
  const [isLogExpanded, setIsLogExpanded] = useState(initialExpanded);
  const logRef = useRef<HTMLDivElement>(null);
  const storeStatus = useBoardStore((state) => state.agentStatus);
  const storeError = useBoardStore((state) => state.agentError);
  const storeLog = useBoardStore((state) => state.agentLog);
  const storeCards = useBoardStore((state) => state.cards);
  const dataSourceMode = useBoardStore((state) => state.dataSourceMode);
  const setDataSourceMode = useBoardStore((state) => state.setDataSourceMode);
  const loadAgentResponse = useBoardStore((state) => state.loadAgentResponse);

  const agentStatus = propStatus ?? storeStatus;
  const agentError = propError ?? storeError;
  const agentLog = propLog ?? storeLog;
  const cards = propCards ?? storeCards;
  const resultCount = propCards !== undefined ? propCards.length : cards.length;

  function handleModeSwitch(mode: DataSourceMode) {
    setDataSourceMode(mode);
    if (mode === 'mock') {
      void loadAgentResponse({ query: INITIAL_ACTIVITY_QUERY }, fixtureAgentClient);
    }
  }

  function handleUseDemo() {
    setDataSourceMode('mock');
    void loadAgentResponse({ query: INITIAL_ACTIVITY_QUERY }, fixtureAgentClient);
  }

  /**
   * `aria-expanded` has to stay true to *what the popover is doing*, not to what the button last
   * did — Escape and an outside click both close it without going through this handler, and a
   * trigger that still reads `aria-expanded="true"` after the popover has gone is lying to a
   * screen reader. The `toggle` event is the only notification that fires for every close path,
   * including the ones the browser performs itself.
   */
  useEffect(() => {
    const popover = logRef.current;
    if (!popover || !canUsePopover(popover)) return;

    function handleToggle(event: Event) {
      const nextOpen = (event as ToggleEvent).newState === 'open';
      setIsLogExpanded(nextOpen);
    }

    popover.addEventListener('toggle', handleToggle);
    return () => popover.removeEventListener('toggle', handleToggle);
  }, []);

  function toggleLog() {
    const popover = logRef.current;
    if (!canUsePopover(popover)) {
      // No Popover API: fall back to the inline disclosure this component used to be.
      setIsLogExpanded((prev) => !prev);
      return;
    }
    // Optimistic, then corrected. The browser queues its `toggle` event to a later task, so
    // waiting for it would leave the button's label and `aria-expanded` describing the previous
    // state for a frame after the popover had already opened. The listener above still has the
    // last word — that is what covers Escape and an outside click, which never come through here.
    if (popover?.matches(':popover-open')) {
      setIsLogExpanded(false);
      popover.hidePopover();
    } else {
      setIsLogExpanded(true);
      popover?.showPopover();
    }
  }

  function hideLog() {
    const popover = logRef.current;
    if (canUsePopover(popover)) {
      popover?.hidePopover();
    }
    setIsLogExpanded(false);
  }

  return (
    <section aria-label={AGENT_STATUS_TITLE} className={`agent-status-panel agent-status-panel--${agentStatus}`}>
      <div className="agent-status-panel__header">
        <div className="agent-status-panel__indicator">
          <span className={`agent-status-dot agent-status-dot--${agentStatus}`} />
          <span className="agent-status-panel__message">
            {agentStatus === 'searching' && AGENT_STATUS_SEARCHING}
            {agentStatus === 'results' && agentStatusResults(resultCount)}
            {agentStatus === 'error' && (agentError ?? AGENT_STATUS_ERROR)}
            {agentStatus === 'idle' && AGENT_STATUS_IDLE}
          </span>
        </div>
        <div className="agent-status-panel__actions">
          <div aria-label={DATA_SOURCE_LABEL} className="segmented" role="group">
            <button
              aria-pressed={dataSourceMode === 'live'}
              className={`segmented__option${dataSourceMode === 'live' ? ' segmented__option--active' : ''}`}
              onClick={() => handleModeSwitch('live')}
              type="button"
            >
              {DATA_SOURCE_LIVE}
            </button>
            <button
              aria-pressed={dataSourceMode === 'mock'}
              className={`segmented__option${dataSourceMode === 'mock' ? ' segmented__option--active' : ''}`}
              onClick={() => handleModeSwitch('mock')}
              type="button"
            >
              {DATA_SOURCE_MOCK}
            </button>
          </div>
          {agentStatus === 'error' ? (
            <button className="btn btn--sm btn--danger" onClick={handleUseDemo} type="button">
              {AGENT_USE_DEMO}
            </button>
          ) : null}
          {agentLog.length > 0 ? (
            <button
              aria-controls={AGENT_LOG_POPOVER_ID}
              aria-expanded={isLogExpanded}
              className="btn btn--sm agent-status-panel__log-trigger"
              onClick={toggleLog}
              type="button"
            >
              {isLogExpanded ? AGENT_LOG_HIDE : AGENT_LOG_SHOW} ({agentLog.length})
            </button>
          ) : null}
        </div>
      </div>
      {/**
       * A native `popover="auto"`, not a div in the flow.
       *
       * It was a `div` in the flow, so opening it stole 98px of board height and pushed every card
       * down — the log is a read-out of what the agent is doing, and reading it must not move the
       * thing you are reading it about. `popover="auto"` fixes that structurally rather than
       * cosmetically: the element moves to the **top layer**, where it is out of flow and no
       * ancestor can clip or reflow around it, and the browser takes care of the three behaviours
       * that are easy to get wrong by hand — light dismiss, Escape, and focus returning to the
       * invoker on close. It is non-modal by definition: no focus trap, and deliberately no
       * `aria-modal`.
       *
       * It still renders here, as a child of the status strip, which is what ADR-0009 asks for —
       * chrome lives outside `.board__pan`, so the log is in screen space and never scales or
       * drifts with the board zoom.
       */}
      <div aria-label={AGENT_LOG_LABEL} className="agent-log" id={AGENT_LOG_POPOVER_ID} popover="auto" ref={logRef}>
        <div className="agent-log__head">
          <h2 className="agent-log__title">{AGENT_LOG_LABEL}</h2>
          <button
            aria-label={AGENT_LOG_CLOSE}
            className="btn btn--sm btn--icon agent-log__close"
            onClick={hideLog}
            type="button"
          >
            <IconClose />
          </button>
        </div>
        {/* `role="log"` on the scrolling body, not on the surface: a live region that swallowed
            the heading would read the popover's own title out as a new agent step. */}
        <div className="agent-log__body" role="log">
          {agentLog.length === 0 ? (
            <p className="agent-log__empty">{AGENT_LOG_EMPTY}</p>
          ) : (
            <ol className="agent-log__list">
              {agentLog.map((entry, index) => (
                <li className={`agent-log-entry agent-log-entry--${entry.level}`} key={`${entry.ts}-${index}`}>
                  <time className="agent-log-entry__time">{formatLogTimestamp(entry.ts)}</time>
                  <span className={`agent-log-entry__level agent-log-entry__level--${entry.level}`}>{entry.level}</span>
                  <span className="agent-log-entry__msg">{entry.message}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}
