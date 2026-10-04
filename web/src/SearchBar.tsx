import { useState, type FormEvent } from 'react';
import {
  FREE_SLOTS_LABEL,
  FREE_TIME_SLOTS,
  INITIAL_ACTIVITY_QUERY,
  SEARCH_INPUT_LABEL,
  SEARCH_INPUT_PLACEHOLDER,
  SEARCH_PANEL_LABEL,
  SEARCH_SUBMIT_LABEL,
  SEARCH_SUBMIT_LOADING,
} from './copy';
import { type AgentStatus, useBoardStore } from './state/boardStore';

export type SearchBarProps = {
  status?: AgentStatus;
  selectedSlotIds?: string[];
  initialQuery?: string;
  onSearch?: (query: string) => void;
  onToggleSlot?: (slotId: string) => void;
};

export function SearchBar({
  status: propStatus,
  selectedSlotIds: propSlotIds,
  initialQuery = INITIAL_ACTIVITY_QUERY,
  onSearch,
  onToggleSlot,
}: SearchBarProps = {}) {
  const [query, setQuery] = useState(initialQuery);
  const storeStatus = useBoardStore((state) => state.agentStatus);
  const storeSlotIds = useBoardStore((state) => state.selectedFreeSlotIds);
  const storeToggle = useBoardStore((state) => state.toggleFreeSlot);
  const storeSubmit = useBoardStore((state) => state.submitSearch);

  const agentStatus = propStatus ?? storeStatus;
  const selectedFreeSlotIds = propSlotIds ?? storeSlotIds;
  const toggleFreeSlot = onToggleSlot ?? storeToggle;
  const submitSearch = onSearch ?? storeSubmit;

  const isSearching = agentStatus === 'searching';

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.trim() || isSearching) {
      return;
    }

    void submitSearch(query.trim());
  }

  return (
    <form aria-label={SEARCH_PANEL_LABEL} className="search-bar" onSubmit={handleSubmit}>
      <div className="search-bar__input-row">
        <label className="sr-only" htmlFor="search-input">
          {SEARCH_INPUT_LABEL}
        </label>
        <input
          className="field search-bar__input"
          disabled={isSearching}
          id="search-input"
          onChange={(event) => setQuery(event.target.value)}
          placeholder={SEARCH_INPUT_PLACEHOLDER}
          type="text"
          value={query}
        />
        <button className="btn btn--primary search-bar__submit" disabled={isSearching || !query.trim()} type="submit">
          {isSearching ? SEARCH_SUBMIT_LOADING : SEARCH_SUBMIT_LABEL}
        </button>
      </div>
      <div aria-label={FREE_SLOTS_LABEL} className="search-bar__chips" role="group">
        {FREE_TIME_SLOTS.map((slot) => {
          const isSelected = selectedFreeSlotIds.includes(slot.id);

          return (
            <button
              aria-pressed={isSelected}
              className={`chip search-bar__chip${isSelected ? ' chip--selected search-bar__chip--selected' : ''}`}
              key={slot.id}
              onClick={() => toggleFreeSlot(slot.id)}
              type="button"
            >
              {slot.label}
            </button>
          );
        })}
      </div>
    </form>
  );
}
