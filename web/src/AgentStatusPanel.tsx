import { useState } from 'react';
import { fixtureAgentClient } from './api/client';
import {
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

export function AgentStatusPanel({
  status: propStatus,
  error: propError,
  log: propLog,
  cards: propCards,
  initialExpanded = false,
}: AgentStatusPanelProps = {}) {
  const [isLogExpanded, setIsLogExpanded] = useState(initialExpanded);
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

  return (
    <section aria-label={AGENT_STATUS_TITLE} className={`agent-status-panel agent-status-panel--${agentStatus}`}>
      <div className="agent-status-panel__header">
        <div className="agent-status-panel__indicator">
          <span className={`agent-status-dot agent-status-dot--${agentStatus}`} />
          <span className="agent-status-panel__message">
            {agentStatus === 'searching' && AGENT_STATUS_SEARCHING}
            {agentStatus === 'results' && agentStatusResults(cards.length)}
            {agentStatus === 'error' && (agentError ?? AGENT_STATUS_ERROR)}
            {agentStatus === 'idle' && AGENT_STATUS_IDLE}
          </span>
        </div>
        <div className="agent-status-panel__actions">
          <div aria-label={DATA_SOURCE_LABEL} className="agent-status-panel__modes" role="group">
            <button
              aria-pressed={dataSourceMode === 'live'}
              className={`agent-status-panel__mode-btn${dataSourceMode === 'live' ? ' agent-status-panel__mode-btn--active' : ''}`}
              onClick={() => handleModeSwitch('live')}
              type="button"
            >
              {DATA_SOURCE_LIVE}
            </button>
            <button
              aria-pressed={dataSourceMode === 'mock'}
              className={`agent-status-panel__mode-btn${dataSourceMode === 'mock' ? ' agent-status-panel__mode-btn--active' : ''}`}
              onClick={() => handleModeSwitch('mock')}
              type="button"
            >
              {DATA_SOURCE_MOCK}
            </button>
          </div>
          {agentStatus === 'error' ? (
            <button className="agent-status-panel__fallback-btn" onClick={handleUseDemo} type="button">
              {AGENT_USE_DEMO}
            </button>
          ) : null}
          {agentLog.length > 0 ? (
            <button
              aria-expanded={isLogExpanded}
              className="agent-status-panel__toggle-btn"
              onClick={() => setIsLogExpanded((prev) => !prev)}
              type="button"
            >
              {isLogExpanded ? AGENT_LOG_HIDE : AGENT_LOG_SHOW} ({agentLog.length})
            </button>
          ) : null}
        </div>
      </div>
      {isLogExpanded ? (
        <div aria-label={AGENT_LOG_LABEL} className="agent-status-panel__log">
          {agentLog.length === 0 ? (
            <p className="agent-status-panel__empty-log">{AGENT_LOG_EMPTY}</p>
          ) : (
            <ol className="agent-status-panel__log-list">
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
      ) : null}
    </section>
  );
}
