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

type BoardStore = {
  cards: ActivityCard[];
  viewport: BoardViewport;
  timelineSlots: TimelineSlot[];
  agentLog: AgentLogEntry[];
  dockCard: (activityId: string, timelineSlotId: string) => boolean;
  loadAgentResponse: (request: AgentRequest, client?: AgentClient) => Promise<void>;
  setTimelineSlots: (timelineSlots: TimelineSlot[]) => void;
  setViewport: (viewport: BoardViewport) => void;
};

const initialViewport: BoardViewport = { x: 0, y: 0, scale: 1 };

export const useBoardStore = create<BoardStore>((set) => ({
  cards: [],
  viewport: initialViewport,
  timelineSlots: [],
  agentLog: [],
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
