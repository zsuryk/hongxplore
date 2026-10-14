# CONTEXT — Domain glossary

> Maintained by the `/domain-modeling` skill; use these terms in issue titles, code and UI copy.

| Term | Definition |
| --- | --- |
| **Activity** | A real-world thing a student can attend or book in Hong Kong (event, session, facility slot). Has title, time slots, location, source, language, tags. The canonical Pydantic model is the single source of truth for the API contract. We say **Activity**, not "event" (an Activity may be a bookable facility slot, not just an event). |
| **Activity card** | The whiteboard representation of an Activity — the pop-in card the agent returns. We say **card**, not "tile" or "result". |
| **Free slot** | A period the user marked as available (via time-slot chips). We say **free slot**, not "availability window". |
| **Timeline slot** | A droppable position on the weekend timeline where a card can dock. We say **timeline slot**, not "slot" alone (that's ambiguous with free slot). |
| **Weekend plan (board)** | The user's assembled set of docked cards on the timeline — the thing being planned. We say **weekend plan**; the whiteboard itself is the **board**. |
| **Agent** | The backend orchestration behind `POST /api/agent`: intent parsing → search → normalise → rank → translate → respond. We say **agent**, not "bot" or "backend". |
| **Seed data** | Bundled JSON dataset of real HK activities used by `DEMO_MODE` and tests. We say **seed data**, not "mock data" (it's real, sourced data — just local). |
| **DEMO_MODE** | Config flag: when true, agent endpoints serve seed JSON instead of live search/LLM calls, so demos never depend on the network. |
| **Guide card** | A card that explains *how to do something* (e.g. booking an LCSD court) rather than listing an Activity. We say **guide card**, not "tutorial". |
| **Match rationale** | The agent's short explanation of *why* an Activity was returned for a query. Attached to each response; shown on/with the card. We say **match rationale**, not "reason" or "score explanation". |
| **Agent log** | The ordered list of steps the agent records while handling a query (parse → search → normalise → rank → translate). Returned as `log` on the agent response and shown in the status panel. We say **agent log**, not "trace" or "activity stream" (that collides with Activity). |
| **Discard bin** | The drop target for rejected cards — removes them from consideration without deleting the underlying Activity. We say **discard bin**, not "trash". |
| **Find similar** | Card action that re-queries the agent using the card as the seed. We say **find similar**, not "discover more". |
| **Price** | What an Activity costs. Three states: **free of charge**, **priced** (an amount plus currency), and **absent** — the source published no pricing. Absent is never shown as free. We say **price**, not "cost field" or "fee". |
| **Listed at** | When the source published or last confirmed the listing, carried as `listed_at` (stored UTC, displayed HKT). Absent when the source dates nothing. We say **listed at**, not "last updated" or "fetched at". |
