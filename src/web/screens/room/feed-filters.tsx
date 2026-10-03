import { useState } from 'react';
import type { AgentView } from '../../../shared/app-types';
import { KIND_GROUPS, filtersOn, type FeedFilters } from './feed-model';

/**
 * Search, agent and kind filters above the feed. On a phone only the search box and a "Filters"
 * button show; the rest opens underneath. On wider screens everything is visible at once.
 */
export function FilterBar({
  agents,
  filters,
  search,
  onSearch,
  onAgent,
  onToggleGroup,
  onClear,
}: {
  agents: AgentView[];
  filters: FeedFilters;
  search: string;
  onSearch: (q: string) => void;
  onAgent: (agentId: string) => void;
  onToggleGroup: (groupId: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const count = filters.groups.length + (filters.agent ? 1 : 0);
  return (
    <div className="feed-filters">
      <div className="feed-search">
        <label className="sr-only" htmlFor="feed-search">
          Search the feed
        </label>
        <input
          id="feed-search"
          type="search"
          className="input"
          placeholder="Search the feed"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && search && onSearch('')}
          autoComplete="off"
        />
      </div>
      <button type="button" className="btn feed-filter-toggle" aria-expanded={open} aria-controls="feed-filter-panel" onClick={() => setOpen(!open)}>
        Filters
        {count > 0 && <span className="pill pill-accent">{count}</span>}
      </button>
      <div id="feed-filter-panel" className={`feed-filter-panel${open ? ' open' : ''}`}>
        <div className="feed-agent">
          <label htmlFor="feed-agent">Agent</label>
          <select id="feed-agent" className="select" value={filters.agent} onChange={(e) => onAgent(e.target.value)}>
            <option value="">Everyone</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="feed-chiprow">
          <div className="feed-chips" role="group" aria-label="Show only">
            {KIND_GROUPS.map((g) => (
              <button key={g.id} type="button" className="feed-chip" aria-pressed={filters.groups.includes(g.id)} onClick={() => onToggleGroup(g.id)}>
                {g.label}
              </button>
            ))}
          </div>
          {filtersOn(filters) && (
            <button type="button" className="btn btn-ghost btn-sm feed-clear" onClick={onClear}>
              Clear filters
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
