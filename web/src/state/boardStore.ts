import { create } from 'zustand';
import { fixtureAgentClient, type AgentClient, type AgentRequest } from '../api/client';
import type { components } from '../api/schema';

export type ActivityCard = components['schemas']['MatchedActivity'];
export type AgentLogEntry = components['schemas']['AgentLogEntry'];

export type BoardViewport = {
  x: number;
  y: number;
  scale: number;
};

export type TimelineSlot = {
  id: string;
  activityId: string | null;
};

export type BoardStore = {
  cards: ActivityCard[];
  discardedCards: ActivityCard[];
  viewport: BoardViewport;
  timelineSlots: TimelineSlot[];
  agentLog: AgentLogEntry[];
  discardCard: (activityId: string) => void;
  dockCard: (activityId: string, timelineSlotId: string) => boolean;
  undockCard: (timelineSlotId: string) => void;
  findSimilar: (card: ActivityCard, client?: AgentClient) => Promise<void>;
  loadAgentResponse: (request: AgentRequest, client?: AgentClient) => Promise<void>;
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
  timelineSlots: [],
  agentLog: [],
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
  dockCard(activityId, timelineSlotId) {
    let docked = false;

    set((state) => {
      // A card occupies at most one timeline slot; occupied destinations reject the drop.
      // This keeps docked cards tied to slot layout, so they reflow when the timeline resizes.
      const destination = state.timelineSlots.find((slot) => slot.id === timelineSlotId);
      if (!destination || (destination.activityId && destination.activityId !== activityId)) {
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
  async findSimilar(card, client = fixtureAgentClient) {
    const response = await client.requestAgent(similarActivityRequest(card));
    const discardedIds = new Set(get().discardedCards.map((discardedCard) => discardedCard.activity.id));

    set((state) => ({
      agentLog: response.log,
      cards: mergeCards(state.cards, response.matches, discardedIds),
    }));
  },
  async loadAgentResponse(request, client = fixtureAgentClient) {
    const response = await client.requestAgent(request);
    set({ cards: response.matches, agentLog: response.log });
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
