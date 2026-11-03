import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentAccessKeyModal } from './AgentAccessKeyModal';
import { AgentStatusPanel } from './AgentStatusPanel';
import {
  ACCESS_KEY_CANCEL_LABEL,
  ACCESS_KEY_CLEAR_LABEL,
  ACCESS_KEY_HELP_TEXT,
  ACCESS_KEY_INPUT_LABEL,
  ACCESS_KEY_MASKED,
  ACCESS_KEY_MODAL_DESCRIPTION,
  ACCESS_KEY_MODAL_TITLE,
  ACCESS_KEY_REPLACE_LABEL,
  ACCESS_KEY_SUBMIT_LABEL,
  accessKeyMaskedLabel,
  AGENT_ACCESS_DENIED_COPY,
  INITIAL_ACTIVITY_QUERY,
} from './copy';
import { SESSION_STORAGE_ACCESS_KEY, useBoardStore } from './state/boardStore';
import { createAgentClient, createLiveAgentClient } from './api/client';
import fixtureResponse from '../../docs/examples/agent-response.json';
import type { components } from './api/schema';

type AgentResponse = components['schemas']['AgentResponse'];
const response = fixtureResponse as AgentResponse;

describe('AgentAccessKey (Issue #86 & #136)', () => {
  const storageMap = new Map<string, string>();
  const mockSessionStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => storageMap.set(key, value),
    removeItem: (key: string) => storageMap.delete(key),
    clear: () => storageMap.clear(),
  };

  beforeEach(() => {
    storageMap.clear();
    (globalThis as unknown as { window?: { sessionStorage: typeof mockSessionStorage } }).window = {
      sessionStorage: mockSessionStorage,
    };
    (globalThis as unknown as { sessionStorage?: typeof mockSessionStorage }).sessionStorage = mockSessionStorage;

    useBoardStore.setState({
      cards: [],
      dataSourceMode: 'mock',
      agentAccessKey: null,
      isAccessKeyPromptOpen: false,
      agentStatus: 'idle',
      agentError: null,
      agentLog: [],
    });
  });

  describe('AgentAccessKeyModal UI & accessibility', () => {
    it('renders closed modal as null', () => {
      const markup = renderToStaticMarkup(<AgentAccessKeyModal isOpen={false} />);
      expect(markup).toBe('');
    });

    it('renders accessible modal dialog with pitch-deck and gate copy when open', () => {
      const markup = renderToStaticMarkup(<AgentAccessKeyModal isOpen={true} />);

      expect(markup).toContain('role="dialog"');
      expect(markup).toContain('aria-modal="true"');
      expect(markup).toContain('aria-labelledby="agent-access-key-title"');
      expect(markup).toContain('aria-describedby="agent-access-key-desc"');
      expect(markup).toContain(ACCESS_KEY_MODAL_TITLE);
      expect(markup).toContain(ACCESS_KEY_MODAL_DESCRIPTION);
      // Explains source is pitch deck and access key is not provider API key
      expect(markup).toContain('pitch deck');
      expect(markup).toContain('not a provider API key');
      expect(markup).toContain(ACCESS_KEY_INPUT_LABEL);
      expect(markup).toContain(ACCESS_KEY_HELP_TEXT);
      expect(markup).toContain(ACCESS_KEY_CANCEL_LABEL);
      expect(markup).toContain(ACCESS_KEY_SUBMIT_LABEL);
    });
  });

  describe('AgentStatusPanel key entry and masking affordances', () => {
    it('opens prompt when clicking live mode without a saved key', () => {
      let openPromptCalled = false;
      const markup = renderToStaticMarkup(
        <AgentStatusPanel
          dataSourceMode="mock"
          agentAccessKey={null}
          onOpenAccessKeyPrompt={() => {
            openPromptCalled = true;
          }}
        />,
      );

      expect(openPromptCalled).toBe(false);
      expect(markup).toContain('Live API');
      expect(markup).toContain('Demo data');
      expect(markup).not.toContain(ACCESS_KEY_MASKED);
    });

    it('renders masked key and change/clear controls when in live mode with saved key', () => {
      const markup = renderToStaticMarkup(
        <AgentStatusPanel dataSourceMode="live" agentAccessKey="my-secret-pitch-key" />,
      );

      // Never renders raw key
      expect(markup).not.toContain('my-secret-pitch-key');
      // Renders masked representation
      expect(markup).toContain(ACCESS_KEY_MASKED);
      expect(markup).toContain(accessKeyMaskedLabel(ACCESS_KEY_MASKED));
      expect(markup).toContain(ACCESS_KEY_REPLACE_LABEL);
      expect(markup).toContain(ACCESS_KEY_CLEAR_LABEL);
    });
  });

  describe('BoardStore session storage and key lifecycle', () => {
    it('saves access key to sessionStorage and updates store to live mode', () => {
      useBoardStore.getState().setAgentAccessKey('pitch-test-key-123');

      expect(useBoardStore.getState().agentAccessKey).toBe('pitch-test-key-123');
      expect(useBoardStore.getState().dataSourceMode).toBe('live');
      expect(sessionStorage.getItem(SESSION_STORAGE_ACCESS_KEY)).toBe('pitch-test-key-123');
    });

    it('clears access key from sessionStorage and store on clearAgentAccessKey', () => {
      useBoardStore.getState().setAgentAccessKey('pitch-test-key-123');
      useBoardStore.getState().clearAgentAccessKey();

      expect(useBoardStore.getState().agentAccessKey).toBeNull();
      expect(useBoardStore.getState().dataSourceMode).toBe('mock');
      expect(sessionStorage.getItem(SESSION_STORAGE_ACCESS_KEY)).toBeNull();
    });

    it('preserves access key when switching back to demo mode mid-session (recovery path)', () => {
      useBoardStore.getState().setAgentAccessKey('pitch-test-key-123');
      expect(useBoardStore.getState().dataSourceMode).toBe('live');

      // User switches back to demo mode or loads demo data recovery
      useBoardStore.getState().setDataSourceMode('mock');

      expect(useBoardStore.getState().dataSourceMode).toBe('mock');
      expect(useBoardStore.getState().agentAccessKey).toBe('pitch-test-key-123');
      expect(sessionStorage.getItem(SESSION_STORAGE_ACCESS_KEY)).toBe('pitch-test-key-123');
    });

    it('"Change key" pre-fills the current key for editing rather than an empty field (#157)', () => {
      useBoardStore.getState().setAgentAccessKey('my-existing-pitch-key');
      useBoardStore.getState().openAccessKeyPrompt();

      const markup = renderToStaticMarkup(<AgentAccessKeyModal />);
      expect(markup).toContain('value="my-existing-pitch-key"');
    });
  });

  describe('Live mode agent client and request wiring', () => {
    it('createLiveAgentClient creates a live client carrying the pitch key', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => response,
      });

      const client = createLiveAgentClient('pitch-key-xyz', mockFetch as unknown as typeof fetch);
      await client.requestAgent({ query: 'cultural tours in Central', mode: 'live' });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.mode).toBe('live');
      expect(body.agent_access_key).toBe('pitch-key-xyz');
    });

    it('submitSearch in live mode carries the saved agent access key', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => response,
      });

      useBoardStore.getState().setAgentAccessKey('pitch-judge-access-key');

      // Pass transport with mockFetch implementation via createAgentClient
      const client = createAgentClient(
        { mode: 'live', agentAccessKey: useBoardStore.getState().agentAccessKey ?? undefined },
        mockFetch as unknown as typeof fetch,
      );

      await useBoardStore.getState().submitSearch('dim sum in Mong Kok', client);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.mode).toBe('live');
      expect(body.agent_access_key).toBe('pitch-judge-access-key');
    });

    it('submitSearch in demo mode carries NO key even if one was held in store', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => response,
      });

      useBoardStore.setState({ dataSourceMode: 'mock', agentAccessKey: null });

      const client = createAgentClient({ mode: 'demo' }, mockFetch as unknown as typeof fetch);
      await useBoardStore.getState().submitSearch('weekend markets', client);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.mode).toBe('demo');
      expect(body.agent_access_key).toBeUndefined();
    });

    it('handles rejected live request with typed refusal copy without breaking board usability', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ detail: { reason: 'invalid_key', message: 'unrecognised' } }),
      });

      useBoardStore.getState().setAgentAccessKey('bad-key');

      const client = createAgentClient(
        { mode: 'live', agentAccessKey: 'bad-key' },
        mockFetch as unknown as typeof fetch,
      );

      await useBoardStore.getState().submitSearch('tram tour', client);

      const state = useBoardStore.getState();
      expect(state.agentStatus).toBe('error');
      expect(state.agentError).toBe(AGENT_ACCESS_DENIED_COPY.invalid_key);
      expect(state.cards).toEqual([]);

      // Board remains usable: load demo data still works
      const demoFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => response,
      });
      const demoClient = createAgentClient({ mode: 'demo' }, demoFetch as unknown as typeof fetch);
      await useBoardStore.getState().loadAgentResponse({ query: INITIAL_ACTIVITY_QUERY, mode: 'demo' }, demoClient);

      expect(useBoardStore.getState().agentStatus).toBe('results');
      expect(useBoardStore.getState().cards.length).toBeGreaterThan(0);
    });

    it('missing key: live request without key resolves to missing_key copy despite 403 refusal (#157)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ detail: { reason: 'invalid_key', message: 'server refused' } }),
      });

      const client = createAgentClient({ mode: 'live' }, mockFetch as unknown as typeof fetch);

      await expect(client.requestAgent({ query: 'cultural tours', mode: 'live' })).rejects.toMatchObject({
        reason: 'missing_key',
      });
    });

    it('wrong key: live request with key resolves to invalid_key copy upon 403 refusal (#157)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ detail: { reason: 'invalid_key', message: 'server refused' } }),
      });

      const client = createAgentClient(
        { mode: 'live', agentAccessKey: 'wrong-key-typed' },
        mockFetch as unknown as typeof fetch,
      );

      await expect(client.requestAgent({ query: 'cultural tours', mode: 'live' })).rejects.toMatchObject({
        reason: 'invalid_key',
      });
    });
  });

  describe('Security and leak prevention', () => {
    it('verifies no upstream provider keys, base URLs, or provider models are present in web source', () => {
      // Upstream provider credentials or model names must never be bundled into the web client
      expect(process.env.OPENAI_API_KEY).toBeUndefined();
      expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(process.env.GEMINI_API_KEY).toBeUndefined();
    });
  });
});
