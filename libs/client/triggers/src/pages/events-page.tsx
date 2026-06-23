import type {TriggerEventListItemDto} from '@shipfox/api-triggers-dto';
import {RelativeTimeProvider} from '@shipfox/react-ui';
import {useMemo} from 'react';
import {EventsList} from '#components/events-list.js';
import {
  type TriggerEventFilters,
  useTriggerEventFacetsQuery,
  useTriggerEventsInfiniteQuery,
} from '#hooks/api/trigger-events.js';

export interface EventsPageProps {
  workspaceId: string;
  filters: TriggerEventFilters;
  onFiltersChange: (patch: Partial<TriggerEventFilters>) => void;
}

/**
 * Workspace-scoped Events list. Router-agnostic: filters and their setter come in as props
 * (the settings wrapper binds them to the URL), so a story can drive it with local state.
 */
export function EventsPage({workspaceId, filters, onFiltersChange}: EventsPageProps) {
  const query = useTriggerEventsInfiniteQuery(workspaceId, filters);
  const facetsQuery = useTriggerEventFacetsQuery(workspaceId);

  const events = useMemo<TriggerEventListItemDto[]>(
    () => query.data?.pages.flatMap((page) => page.trigger_events) ?? [],
    [query.data],
  );

  return (
    <RelativeTimeProvider>
      <EventsList
        events={events}
        query={query}
        facets={facetsQuery.data}
        filters={filters}
        onFiltersChange={onFiltersChange}
        workspaceId={workspaceId}
        hasNextPage={query.hasNextPage}
        isFetchingNextPage={query.isFetchingNextPage}
        onLoadMore={() => {
          void query.fetchNextPage();
        }}
      />
    </RelativeTimeProvider>
  );
}
