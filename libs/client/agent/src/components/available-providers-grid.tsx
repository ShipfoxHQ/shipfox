import type {AgentProviderCatalogEntryDto} from '@shipfox/api-agent-dto';
import {Button, EmptyState, Icon, Input} from '@shipfox/react-ui';
import {useMemo, useRef, useState} from 'react';
import {AvailableProviderCard} from './available-provider-card.js';
import {providerMatchesSearch} from './provider-search.js';

export const PROVIDER_GRID_CLASS = 'grid grid-cols-2 gap-12 max-[760px]:grid-cols-1';

const SEARCH_VISIBILITY_THRESHOLD = 8;
const MAX_ECHOED_QUERY_LENGTH = 40;

export function AvailableProvidersGrid({
  entries,
  onSelect,
}: {
  entries: AgentProviderCatalogEntryDto[];
  onSelect: (entry: AgentProviderCatalogEntryDto) => void;
}) {
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const trimmedSearch = search.trim();
  const showSearch = entries.length > SEARCH_VISIBILITY_THRESHOLD || trimmedSearch !== '';
  const filteredEntries = useMemo(
    () => entries.filter((entry) => providerMatchesSearch(entry, search)),
    [entries, search],
  );

  function clearSearch() {
    setSearch('');
    inputRef.current?.focus();
  }

  return (
    <div className="flex flex-col gap-12">
      {showSearch ? (
        <Input
          ref={inputRef}
          type="search"
          aria-label="Search providers"
          placeholder="Search providers..."
          value={search}
          iconLeft={<Icon name="searchLine" className="size-16 text-foreground-neutral-muted" />}
          onChange={(event) => setSearch(event.target.value)}
        />
      ) : null}

      {filteredEntries.length > 0 ? (
        <ul className={PROVIDER_GRID_CLASS} aria-label="Available providers matching search">
          {filteredEntries.map((entry) => (
            <AvailableProviderCard
              key={entry.id}
              entry={entry}
              onConfigure={() => onSelect(entry)}
            />
          ))}
        </ul>
      ) : (
        <NoProviderSearchResults search={trimmedSearch} onClear={clearSearch} />
      )}

      {trimmedSearch !== '' ? (
        <p role="status" aria-live="polite" className="sr-only">
          {filteredEntries.length} providers match "{trimmedSearch}"
        </p>
      ) : null}
    </div>
  );
}

function NoProviderSearchResults({search, onClear}: {search: string; onClear: () => void}) {
  return (
    <EmptyState
      icon="searchLine"
      title={`No providers match "${truncateQuery(search)}"`}
      description="Try a different search, or clear it to see all providers."
      action={
        <Button size="sm" variant="secondary" onClick={onClear}>
          Clear search
        </Button>
      }
    />
  );
}

function truncateQuery(query: string): string {
  if (query.length <= MAX_ECHOED_QUERY_LENGTH) return query;
  return `${query.slice(0, MAX_ECHOED_QUERY_LENGTH - 3)}...`;
}
