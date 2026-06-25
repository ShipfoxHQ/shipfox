import {QueryLoadError} from '@shipfox/client-ui';
import {Button, Table, TableBody, TableHead, TableHeader, TableRow} from '@shipfox/react-ui';
import type {TriggerEventFilters} from '#hooks/api/trigger-events.js';
import {EventsFilterBar} from './events-filter-bar.js';
import {
  EventsListEmpty,
  EventsListNoMatches,
  EventsListSkeleton,
  EventsListStaleError,
} from './events-list-states.js';
import {TriggerEventRow} from './trigger-event-row.js';
import type {EventsListProps} from './types.js';

function hasAnyFilter(filters: TriggerEventFilters): boolean {
  return Boolean(
    (filters.source && filters.source.length > 0) ||
      (filters.event && filters.event.length > 0) ||
      filters.from ||
      filters.to ||
      (filters.outcome && filters.outcome.length > 0),
  );
}

export function EventsList({
  events,
  query,
  facets,
  filters,
  onFiltersChange,
  workspaceId,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: EventsListProps) {
  const activeFilters = hasAnyFilter(filters);
  const refreshFailed = query.isError && query.data !== undefined;
  const showEmptyState = !query.isPending && !query.isError && events.length === 0;

  function clearFilters() {
    onFiltersChange({
      source: undefined,
      event: undefined,
      outcome: undefined,
      from: undefined,
      to: undefined,
    });
  }

  return (
    <div className="flex min-h-0 flex-col">
      <EventsFilterBar
        filters={filters}
        onFiltersChange={onFiltersChange}
        sources={facets?.sources}
        events={facets?.events}
        hasActiveFilters={activeFilters}
        onClear={clearFilters}
      />

      {query.isPending ? <EventsListSkeleton /> : null}
      {!query.isPending ? <QueryLoadError query={query} subject="events" icon="pulseLine" /> : null}
      {!query.isPending && refreshFailed ? <EventsListStaleError query={query} /> : null}
      {showEmptyState && !activeFilters ? <EventsListEmpty workspaceId={workspaceId} /> : null}
      {showEmptyState && activeFilters ? <EventsListNoMatches onClear={clearFilters} /> : null}

      {events.length > 0 ? (
        <>
          <Table>
            <TableHeader className="sticky top-0 z-10">
              <TableRow>
                <TableHead className="w-0 pr-0">
                  <span className="sr-only">Status</span>
                </TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Delivery</TableHead>
                <TableHead className="text-right">Received</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <TriggerEventRow key={event.id} event={event} />
              ))}
            </TableBody>
          </Table>
          {hasNextPage ? (
            <div className="flex justify-center p-16">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                isLoading={isFetchingNextPage}
                onClick={onLoadMore}
              >
                Load more
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
