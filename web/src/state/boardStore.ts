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
