import { create } from 'zustand';
import {
  defaultAgentClient,
  demoAgentClient,
  fixtureAgentClient,
  type AgentClient,
  type AgentRequest,
} from '../api/client';
import type { components } from '../api/schema';
import { computeBoardLayout } from '../boardLayout';
import {
  AGENT_ERROR_LOG_PREFIX,
  AGENT_STATUS_ERROR,
  formatAgentErrorMessage,
  getUpcomingWeekendFreeSlots,
  INITIAL_ACTIVITY_QUERY,
  isServerUnreachable,
  TIMELINE_SLOTS,
} from '../copy';
import type { Point } from '../viewport';

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
  cardPositions: Record<string, Point>;
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
  isClearConfirmOpen: boolean;
  discardCard: (activityId: string) => void;
  dockCard: (activityId: string, timelineSlotId: string, options?: { replace?: boolean }) => boolean;
  undockCard: (timelineSlotId: string) => void;
  requestClearBoard: () => void;
  cancelClearBoard: () => void;
  confirmClearBoard: () => void;
  clearBoard: () => void;
  setCardPosition: (activityId: string, position: Point) => void;
  setCardPositions: (positions: Record<string, Point>) => void;
  findSimilar: (card: ActivityCard, client?: AgentClient) => Promise<boolean>;
  loadAgentResponse: (request: AgentRequest, client?: AgentClient) => Promise<void>;
  submitSearch: (query: string, client?: AgentClient, options?: { referenceTime?: Date }) => Promise<void>;
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
    mode: 'demo',
  };
}

export const useBoardStore = create<BoardStore>((set, get) => ({
  cards: [],
  cardPositions: {},
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
  isClearConfirmOpen: false,
  discardCard(activityId) {
    set((state) => {
      const card = state.cards.find((candidate) => candidate.activity.id === activityId);

      if (!card) {
        return state;
      }

      const remainingPositions = { ...state.cardPositions };
      delete remainingPositions[activityId];

      return {
        cards: state.cards.filter((candidate) => candidate.activity.id !== activityId),
        cardPositions: remainingPositions,
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
  requestClearBoard() {
    set({ isClearConfirmOpen: true });
  },
  cancelClearBoard() {
    set({ isClearConfirmOpen: false });
  },
  confirmClearBoard() {
    get().clearBoard();
  },
  clearBoard() {
    set({
      cards: [],
      cardPositions: {},
      discardedCards: [],
      timelineSlots: TIMELINE_SLOTS.map((slot) => ({ id: slot.id, activityId: null })),
      recentCardIds: [],
      isClearConfirmOpen: false,
      agentStatus: 'idle',
      agentError: null,
      lastMatchCount: null,
    });
  },
  setCardPosition(activityId, position) {
    set((state) => ({
      cardPositions: {
        ...state.cardPositions,
        [activityId]: position,
      },
    }));
  },
  setCardPositions(positions) {
    set((state) => ({
      cardPositions: {
        ...state.cardPositions,
        ...positions,
      },
    }));
  },
  async findSimilar(card, client) {
    const activeClient = client ?? (get().dataSourceMode === 'mock' ? demoAgentClient : defaultAgentClient);
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

      if (newlyAddedMatches.length === 0) {
        const title = card.activity.title_en ?? card.activity.title;
        set((state) => ({
          agentError: null,
          agentLog: [
            ...state.agentLog,
            ...response.log,
            {
              level: 'info',
              message: `No new unplaced activities found similar to ${title}.`,
              ts: new Date().toISOString(),
            },
          ],
          agentStatus: 'results',
          lastMatchCount: 0,
          recentCardIds: [],
        }));
        return false;
      }

      const nextCards = mergeCards(get().cards, response.matches, discardedIds);
      const layout = computeBoardLayout({
        cards: nextCards,
        discardedCards: get().discardedCards,
        dockedCardIds: get()
          .timelineSlots.map((s) => s.activityId)
          .filter((id): id is string => Boolean(id)),
        customPositions: get().cardPositions,
      });

      set({
        cards: nextCards,
        cardPositions: layout.positionsById,
        agentLog: response.log,
        agentStatus: 'results',
        agentError: null,
        lastMatchCount: newlyAddedMatches.length,
        recentCardIds: newlyAddedMatches.map((match) => match.activity.id),
      });
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
  async submitSearch(query, client, options) {
    const selectedSlots = get().selectedFreeSlotIds;
    const availableSlots = getUpcomingWeekendFreeSlots(options?.referenceTime);
    const freeSlots = availableSlots
      .filter((slot) => selectedSlots.includes(slot.id))
      .map((slot) => ({
        start: slot.start,
        end: slot.end,
      }));

    const activeClient = client ?? (get().dataSourceMode === 'mock' ? demoAgentClient : defaultAgentClient);

    await get().loadAgentResponse(
      {
        query,
        mode: 'demo',
        ...(freeSlots.length > 0 ? { free_slots: freeSlots } : {}),
      },
      activeClient,
    );
  },
  async loadAgentResponse(request, client) {
    const activeClient = client ?? (get().dataSourceMode === 'mock' ? demoAgentClient : defaultAgentClient);
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

      const isInitial = request.query === INITIAL_ACTIVITY_QUERY && get().cards.length === 0;
      const nextCards = isInitial ? response.matches : mergeCards(get().cards, response.matches, discardedIds);

      const layout = computeBoardLayout({
        cards: nextCards,
        discardedCards: get().discardedCards,
        dockedCardIds: get()
          .timelineSlots.map((s) => s.activityId)
          .filter((id): id is string => Boolean(id)),
        customPositions: get().cardPositions,
      });

      set({
        cards: nextCards,
        cardPositions: layout.positionsById,
        agentLog: response.log,
        agentStatus: 'results',
        agentError: null,
        lastMatchCount: response.matches.length,
        recentCardIds: isInitial ? [] : newlyAddedMatches.map((match) => match.activity.id),
      });
    } catch (error) {
      // The bundled fixture stands in for exactly one situation: no API was
      // reachable. A *refusal* is not that situation — serving seed results to a
      // judge whose live request was rejected would show them demo data while
      // they believe it is live, which is the one outcome the gate exists to
      // prevent. So the question is "was there no server?", not "was this the
      // first query?" — which means a mid-pitch query keeps its fallback too,
      // and lands on the fixture's local matcher (issue #128) rather than the
      // one canned response.
      if (activeClient !== fixtureAgentClient && isServerUnreachable(error)) {
        try {
          const fallback = await fixtureAgentClient.requestAgent(request);
          const layout = computeBoardLayout({
            cards: fallback.matches,
            discardedCards: get().discardedCards,
            dockedCardIds: get()
              .timelineSlots.map((s) => s.activityId)
              .filter((id): id is string => Boolean(id)),
            customPositions: get().cardPositions,
          });
          set({
            cards: fallback.matches,
            cardPositions: layout.positionsById,
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
