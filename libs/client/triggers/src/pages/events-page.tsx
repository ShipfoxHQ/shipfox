import type {TriggerEventListItemDto} from '@shipfox/api-triggers-dto';
import {cn, Header, RelativeTimeProvider, Text} from '@shipfox/react-ui';
import {useEffect, useMemo, useState} from 'react';
import {EventsList} from '#components/events-list.js';
import {TriggerEventDetail} from '#components/trigger-event-detail.js';
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
  const [selectedEventId, setSelectedEventId] = useState<string | undefined>();

  const events = useMemo<TriggerEventListItemDto[]>(
    () => query.data?.pages.flatMap((page) => page.trigger_events) ?? [],
    [query.data],
  );

  useEffect(() => {
    if (!selectedEventId || query.isPending || query.isFetching || query.isError) return;
    if (!events.some((event) => event.id === selectedEventId)) setSelectedEventId(undefined);
  }, [events, query.isError, query.isFetching, query.isPending, selectedEventId]);

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

        <div className="grid min-h-0 gap-16 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
          <div className={cn('min-w-0', selectedEventId && 'max-[899px]:hidden')}>
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
              selectedEventId={selectedEventId}
              onSelectEvent={setSelectedEventId}
            />
          </div>
          <TriggerEventDetail
            workspaceId={workspaceId}
            eventId={selectedEventId}
            onBack={() => setSelectedEventId(undefined)}
          />
        </div>
      </section>
    </RelativeTimeProvider>
  );
}
