import { create } from 'zustand';
import { defaultAgentClient, fixtureAgentClient, type AgentClient, type AgentRequest } from '../api/client';
import type { components } from '../api/schema';
import {
  AGENT_ERROR_LOG_PREFIX,
  AGENT_STATUS_ERROR,
  formatAgentErrorMessage,
  FREE_TIME_SLOTS,
  INITIAL_ACTIVITY_QUERY,
  TIMELINE_SLOTS,
} from '../copy';

export type ActivityCard = components['schemas']['MatchedActivity'];
export type AgentLogEntry = components['schemas']['AgentLogEntry'];
export type AgentStatus = 'idle' | 'searching' | 'results' | 'error';

export type BoardViewport = {
  x: number;
  y: number;
  scale: number;
};

export type TimelineSlot = {
  id: string;
  activityId: string | null;
};

export type DataSourceMode = 'live' | 'mock';

export type BoardStore = {
  cards: ActivityCard[];
  discardedCards: ActivityCard[];
  viewport: BoardViewport;
  timelineSlots: TimelineSlot[];
  agentLog: AgentLogEntry[];
  agentStatus: AgentStatus;
  agentError: string | null;
  lastMatchCount: number | null;
  dataSourceMode: DataSourceMode;
  selectedFreeSlotIds: string[];
  recentCardIds: string[];
  discardCard: (activityId: string) => void;
  dockCard: (activityId: string, timelineSlotId: string, options?: { replace?: boolean }) => boolean;
  undockCard: (timelineSlotId: string) => void;
  findSimilar: (card: ActivityCard, client?: AgentClient) => Promise<boolean>;
  loadAgentResponse: (request: AgentRequest, client?: AgentClient) => Promise<void>;
  submitSearch: (query: string, client?: AgentClient) => Promise<void>;
  toggleFreeSlot: (slotId: string) => void;
  setDataSourceMode: (mode: DataSourceMode) => void;
  setTimelineSlots: (timelineSlots: TimelineSlot[]) => void;
  setViewport: (viewport: BoardViewport) => void;
};

const initialViewport: BoardViewport = { x: 0, y: 0, scale: 1 };

export function similarActivityRequest(card: ActivityCard): AgentRequest {
  const title = card.activity.title_en ?? card.activity.title;
  const tags = card.activity.tags.join(', ');

  return {
    query: `Find activities similar to ${title} in ${card.activity.location.district}: ${tags}`,
  };
}

export const useBoardStore = create<BoardStore>((set, get) => ({
  cards: [],
  discardedCards: [],
  viewport: initialViewport,
  timelineSlots: TIMELINE_SLOTS.map((slot) => ({ id: slot.id, activityId: null })),
  agentLog: [],
  agentStatus: 'idle',
  agentError: null,
  lastMatchCount: null,
  dataSourceMode: 'live',
  selectedFreeSlotIds: [],
  recentCardIds: [],
  discardCard(activityId) {
    set((state) => {
      const card = state.cards.find((candidate) => candidate.activity.id === activityId);

      if (!card) {
        return state;
      }

      return {
        cards: state.cards.filter((candidate) => candidate.activity.id !== activityId),
        discardedCards: [...state.discardedCards, card],
        timelineSlots: state.timelineSlots.map((slot) =>
          slot.activityId === activityId ? { ...slot, activityId: null } : slot,
        ),
      };
    });
  },
  dockCard(activityId, timelineSlotId, options) {
    let docked = false;

    set((state) => {
      // A card occupies at most one timeline slot; occupied destinations reject the drop unless replace=true.
      const destination = state.timelineSlots.find((slot) => slot.id === timelineSlotId);
      if (!destination || (!options?.replace && destination.activityId && destination.activityId !== activityId)) {
        return state;
      }

      docked = true;
      return {
        timelineSlots: state.timelineSlots.map((slot) => {
          if (slot.id === timelineSlotId) {
            return { ...slot, activityId };
          }

          return slot.activityId === activityId ? { ...slot, activityId: null } : slot;
        }),
      };
    });

    return docked;
  },
  undockCard(timelineSlotId) {
    set((state) => ({
      timelineSlots: state.timelineSlots.map((slot) =>
        slot.id === timelineSlotId ? { ...slot, activityId: null } : slot,
      ),
    }));
  },
  async findSimilar(card, client) {
    const activeClient = client ?? (get().dataSourceMode === 'mock' ? fixtureAgentClient : defaultAgentClient);
    set({ agentStatus: 'searching', agentError: null });
    try {
      const response = await activeClient.requestAgent(similarActivityRequest(card));
      if (response.status === 'error') {
        const errorMsg = response.error ?? AGENT_STATUS_ERROR;
        set((state) => ({
          agentStatus: 'error',
          agentError: errorMsg,
          lastMatchCount: null,
          agentLog: [
            ...state.agentLog,
            {
              ts: new Date().toISOString(),
              level: 'error',
              message: `${AGENT_ERROR_LOG_PREFIX}: ${errorMsg}`,
            },
          ],
        }));
        return false;
      }

      const discardedIds = new Set(get().discardedCards.map((discardedCard) => discardedCard.activity.id));
      const existingIds = new Set(get().cards.map((card) => card.activity.id));
      const newlyAddedMatches = response.matches.filter(
        (match) => !existingIds.has(match.activity.id) && !discardedIds.has(match.activity.id),
      );

      set((state) => ({
        cards: mergeCards(state.cards, response.matches, discardedIds),
        agentLog: response.log,
        agentStatus: 'results',
        agentError: null,
        lastMatchCount: response.matches.length,
        recentCardIds: newlyAddedMatches.map((match) => match.activity.id),
      }));
      return true;
    } catch (error) {
      const message = formatAgentErrorMessage(error);
      set((state) => ({
        agentStatus: 'error',
        agentError: message,
        lastMatchCount: null,
        agentLog: [
          ...state.agentLog,
          {
            ts: new Date().toISOString(),
            level: 'error',
            message: `${AGENT_ERROR_LOG_PREFIX}: ${message}`,
          },
        ],
      }));
      return false;
    }
  },
  toggleFreeSlot(slotId) {
    set((state) => {
      const isSelected = state.selectedFreeSlotIds.includes(slotId);
      return {
        selectedFreeSlotIds: isSelected
          ? state.selectedFreeSlotIds.filter((id) => id !== slotId)
          : [...state.selectedFreeSlotIds, slotId],
      };
    });
  },
  setDataSourceMode(dataSourceMode) {
    set({ dataSourceMode });
  },
  async submitSearch(query, client) {
    const selectedSlots = get().selectedFreeSlotIds;
    const freeSlots = FREE_TIME_SLOTS.filter((slot) => selectedSlots.includes(slot.id)).map((slot) => ({
      start: slot.start,
      end: slot.end,
    }));

    const activeClient = client ?? (get().dataSourceMode === 'mock' ? fixtureAgentClient : defaultAgentClient);

    await get().loadAgentResponse(
      {
        query,
        ...(freeSlots.length > 0 ? { free_slots: freeSlots } : {}),
      },
      activeClient,
    );
  },
  async loadAgentResponse(request, client) {
    const activeClient = client ?? (get().dataSourceMode === 'mock' ? fixtureAgentClient : defaultAgentClient);
    set({ agentStatus: 'searching', agentError: null });
    try {
      const response = await activeClient.requestAgent(request);
      if (response.status === 'error') {
        const errorMsg = response.error ?? AGENT_STATUS_ERROR;
        set((state) => ({
          agentStatus: 'error',
          agentError: errorMsg,
          lastMatchCount: null,
          agentLog: [
            ...state.agentLog,
            {
              ts: new Date().toISOString(),
              level: 'error',
              message: `${AGENT_ERROR_LOG_PREFIX}: ${errorMsg}`,
            },
          ],
        }));
        return;
      }

      const discardedIds = new Set(get().discardedCards.map((discardedCard) => discardedCard.activity.id));
      const existingIds = new Set(get().cards.map((card) => card.activity.id));
      const newlyAddedMatches = response.matches.filter(
        (match) => !existingIds.has(match.activity.id) && !discardedIds.has(match.activity.id),
      );

      set((state) => ({
        cards:
          request.query === INITIAL_ACTIVITY_QUERY && state.cards.length === 0
            ? response.matches
            : mergeCards(state.cards, response.matches, discardedIds),
        agentLog: response.log,
        agentStatus: 'results',
        agentError: null,
        lastMatchCount: response.matches.length,
        recentCardIds:
          request.query === INITIAL_ACTIVITY_QUERY && state.cards.length === 0
            ? []
            : newlyAddedMatches.map((match) => match.activity.id),
      }));
    } catch (error) {
      if (activeClient !== fixtureAgentClient && request.query === INITIAL_ACTIVITY_QUERY) {
        try {
          const fallback = await fixtureAgentClient.requestAgent(request);
          set({
            cards: fallback.matches,
            agentLog: fallback.log,
            agentStatus: 'results',
            agentError: null,
            lastMatchCount: fallback.matches.length,
            recentCardIds: [],
            dataSourceMode: 'mock',
          });
          return;
        } catch {
          // fall through to error handling
        }
      }

      const message = formatAgentErrorMessage(error);
      set((state) => ({
        agentStatus: 'error',
        agentError: message,
        lastMatchCount: null,
        agentLog: [
          ...state.agentLog,
          {
            ts: new Date().toISOString(),
            level: 'error',
            message: `${AGENT_ERROR_LOG_PREFIX}: ${message}`,
          },
        ],
      }));
    }
  },
  setTimelineSlots(timelineSlots) {
    set({ timelineSlots });
  },
  setViewport(viewport) {
    set({ viewport });
  },
}));

function mergeCards(
  currentCards: ActivityCard[],
  incomingCards: ActivityCard[],
  discardedIds: Set<string>,
): ActivityCard[] {
  const existingIds = new Set(currentCards.map((card) => card.activity.id));

  return [
    ...currentCards,
    ...incomingCards.filter((card) => !existingIds.has(card.activity.id) && !discardedIds.has(card.activity.id)),
  ];
}
