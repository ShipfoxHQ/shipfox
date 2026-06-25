import type {TriggerEventListItemDto} from '@shipfox/api-triggers-dto';
import {Header, RelativeTimeProvider, Text} from '@shipfox/react-ui';
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
      <section className="flex min-w-0 flex-col gap-16" aria-labelledby="trigger-events-heading">
        <div className="flex flex-col gap-4">
          <Header id="trigger-events-heading" variant="h3">
            Events
          </Header>
          <Text size="sm" className="text-foreground-neutral-muted">
            A workspace-wide audit log of trigger events received from integrations, schedules, and
            manual trigger calls.
          </Text>
        </div>

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
      </section>
    </RelativeTimeProvider>
  );
}
