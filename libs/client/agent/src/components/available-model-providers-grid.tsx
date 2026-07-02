import type {ModelProviderCatalogEntryDto} from '@shipfox/api-agent-dto';
import {Button, EmptyState, Icon, Input} from '@shipfox/react-ui';
import {useMemo, useRef, useState} from 'react';
import {AvailableModelProviderCard} from './available-model-provider-card.js';
import {modelProviderMatchesSearch} from './model-provider-search.js';

export const MODEL_PROVIDER_GRID_CLASS = 'grid grid-cols-2 gap-12 max-[760px]:grid-cols-1';

const SEARCH_VISIBILITY_THRESHOLD = 8;
const MAX_ECHOED_QUERY_LENGTH = 40;

export function AvailableModelProvidersGrid<TEntry extends ModelProviderCatalogEntryDto>({
  entries,
  onSelect,
}: {
  entries: TEntry[];
  onSelect: (entry: TEntry) => void;
}) {
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const trimmedSearch = search.trim();
  const showSearch = entries.length > SEARCH_VISIBILITY_THRESHOLD || trimmedSearch !== '';
  const filteredEntries = useMemo(
    () => entries.filter((entry) => modelProviderMatchesSearch(entry, search)),
    [entries, search],
  );
  const modelProviderListLabel =
    trimmedSearch !== ''
      ? 'Available model providers matching search'
      : 'Available model providers';
  const resultCountText =
    trimmedSearch === '' ? '' : modelProviderResultCountText(filteredEntries.length, trimmedSearch);

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
          aria-label="Search model providers"
          placeholder="Search model providers..."
          value={search}
          iconLeft={<Icon name="searchLine" className="size-16 text-foreground-neutral-muted" />}
          onChange={(event) => setSearch(event.target.value)}
        />
      ) : null}

      {filteredEntries.length > 0 ? (
        <ul className={MODEL_PROVIDER_GRID_CLASS} aria-label={modelProviderListLabel}>
          {filteredEntries.map((entry) => (
            <AvailableModelProviderCard
              key={entry.id}
              entry={entry}
              onConfigure={() => onSelect(entry)}
            />
          ))}
        </ul>
      ) : (
        <NoModelProviderSearchResults search={trimmedSearch} onClear={clearSearch} />
      )}

      <p role="status" aria-live="polite" className="sr-only">
        {resultCountText}
      </p>
    </div>
  );
}

function NoModelProviderSearchResults({search, onClear}: {search: string; onClear: () => void}) {
  return (
    <EmptyState
      icon="searchLine"
      title={`No model providers match "${truncateQuery(search)}"`}
      description="Try a different search, or clear it to see all model providers."
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

function modelProviderResultCountText(count: number, query: string): string {
  if (count === 1) return `1 model provider matches "${query}"`;
  return `${count} model providers match "${query}"`;
}
