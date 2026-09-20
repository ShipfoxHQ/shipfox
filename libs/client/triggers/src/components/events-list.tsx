import {QueryLoadError} from '@shipfox/client-ui';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {DataTable, DataTableToolbar} from '@shipfox/react-ui/data-table';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {RelativeTime} from '@shipfox/react-ui/relative-time';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Code, Text} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';
import {Link} from '@tanstack/react-router';
import {createColumnHelper, metaHelper, tableFeatures, useTable} from '@tanstack/react-table';
import type {KeyboardEvent, MouseEvent, ReactNode} from 'react';
import {hasTriggerEventFilters, type TriggerEventSummary} from '#core/trigger-event.js';
import {EventsFilterBar} from './events-filter-bar.js';
import {triggerEventResult} from './trigger-event-result.js';
import {TriggerSourceIcon} from './trigger-source-icon.js';
import type {EventsListProps} from './types.js';

interface EventsTableMeta {
  onSelectEvent: (eventId: string) => void;
}

const eventsTableFeatures = tableFeatures({tableMeta: metaHelper<EventsTableMeta>()});
const eventColumnHelper = createColumnHelper<typeof eventsTableFeatures, TriggerEventSummary>();

const eventColumns = eventColumnHelper.columns([
  eventColumnHelper.display({
    id: 'event',
    header: 'Event',
    cell: ({row, table}) => (
      <EventCell event={row.original} onSelect={table.options.meta?.onSelectEvent} />
    ),
  }),
  eventColumnHelper.display({
    id: 'result',
    header: 'Result',
    cell: ({row}) => {
      const result = triggerEventResult(row.original);
      return (
        <Text
          size="sm"
          className={cn(
            result.isFailure ? 'text-foreground-highlight-error' : 'text-foreground-neutral-subtle',
          )}
        >
          {result.label}
        </Text>
      );
    },
  }),
  eventColumnHelper.display({
    id: 'received',
    header: () => <span className="block text-right">Received</span>,
    cell: ({row}) => (
      <div className="text-right">
        <Code as="span" variant="label" className="text-foreground-neutral-muted">
          <RelativeTime value={row.original.receivedAt} />
        </Code>
      </div>
    ),
  }),
]);

export function EventsList({
  events,
  query,
  facets,
  filters,
  onFiltersChange,
  workspaceSlug,
  hasNextPage,
  onLoadMore,
  selectedEventId,
  onSelectEvent,
}: EventsListProps) {
  const activeFilters = hasTriggerEventFilters(filters);
  const refreshFailed = query.isError && query.data !== undefined && !query.isFetchNextPageError;
  const table = useTable({
    columns: eventColumns,
    data: events,
    features: eventsTableFeatures,
    getRowId: (event) => event.id,
    meta: {onSelectEvent},
  });

  function clearFilters() {
    onFiltersChange({
      source: undefined,
      event: undefined,
      outcome: undefined,
      from: undefined,
      to: undefined,
    });
  }

  function getRowFromTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement) || target.closest('button,a')) return undefined;
    return target.closest<HTMLElement>('[data-row-id]')?.dataset.rowId;
  }

  function handleTableClick(clickEvent: MouseEvent<HTMLElement>) {
    const eventId = getRowFromTarget(clickEvent.target);
    if (eventId) onSelectEvent(eventId);
  }

  function handleTableKeyDown(keyEvent: KeyboardEvent<HTMLElement>) {
    if (keyEvent.key !== 'Enter' && keyEvent.key !== ' ') return;
    const eventId = getRowFromTarget(keyEvent.target);
    if (eventId) onSelectEvent(eventId);
  }

  const emptyContent = getEmptyContent({
    activeFilters,
    query,
    onClear: clearFilters,
    workspaceSlug,
  });

  return (
    <section
      aria-label="Trigger event list"
      onClick={handleTableClick}
      onKeyDown={handleTableKeyDown}
    >
      <DataTable
        table={table}
        aria-label="Trigger events"
        emptyContent={emptyContent}
        getRowProps={(row) => ({
          className: 'cursor-pointer',
          'data-selected': row.id === selectedEventId,
        })}
        isLoading={query.isPending}
        isRefreshing={query.isFetching && !query.isFetchingNextPage}
        loadingLabel="Loading events"
        loadingRowCount={8}
        {...(events.length > 0
          ? {
              navigation: {
                hasMore: hasNextPage,
                isError: query.isFetchNextPageError,
                isLoading: query.isFetchingNextPage,
                kind: 'append' as const,
                loadedCount: events.length,
                onLoadMore,
                onRetry: onLoadMore,
              },
            }
          : {})}
        stickyHeader
        toolbar={
          <div className="flex min-w-0 flex-col gap-group">
            <DataTableToolbar
              clearFiltersAction={
                activeFilters ? (
                  <Button
                    type="button"
                    size="2xs"
                    variant="transparentMuted"
                    onClick={clearFilters}
                  >
                    Clear filters
                  </Button>
                ) : undefined
              }
            >
              <EventsFilterBar
                filters={filters}
                onFiltersChange={onFiltersChange}
                sources={facets?.sources}
                events={facets?.events}
              />
            </DataTableToolbar>
            {refreshFailed ? <EventsRefreshError query={query} /> : null}
          </div>
        }
      />
    </section>
  );
}

function getEmptyContent({
  activeFilters,
  query,
  onClear,
  workspaceSlug,
}: {
  activeFilters: boolean;
  query: EventsListProps['query'];
  onClear: () => void;
  workspaceSlug?: string | undefined;
}): ReactNode {
  if (query.isError && query.data === undefined) {
    return <QueryLoadError query={query} subject="events" icon="pulseLine" variant="panel" />;
  }

  if (activeFilters) {
    return (
      <EmptyState
        icon="filterOffLine"
        title="No matching events"
        description="No events match your current filters."
        action={
          <Button type="button" size="sm" variant="secondary" onClick={onClear}>
            Clear filters
          </Button>
        }
        variant="panel"
      />
    );
  }

  return (
    <EmptyState
      icon="pulseLine"
      title="No events yet"
      description="Events appear here once a connected integration delivers one or you fire a trigger."
      action={
        workspaceSlug ? (
          <Button asChild size="sm" variant="secondary">
            <Link to="/w/$workspaceSlug/settings/integrations" params={{workspaceSlug}}>
              Configure integrations
            </Link>
          </Button>
        ) : undefined
      }
      variant="panel"
    />
  );
}

function EventsRefreshError({query}: {query: EventsListProps['query']}) {
  return (
    <div className="p-tight">
      <Callout role="alert" type="error">
        <div className="flex items-center justify-between gap-inline">
          <Text size="xs">Could not refresh events.</Text>
          <Button
            type="button"
            size="2xs"
            variant="secondary"
            isLoading={query.isFetching}
            onClick={() => {
              void query.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      </Callout>
    </div>
  );
}

function EventCell({
  event,
  onSelect,
}: {
  event: TriggerEventSummary;
  onSelect: ((eventId: string) => void) | undefined;
}) {
  const eventLabel = event.event || event.source;
  const fullEventLabel = [event.source, event.event].filter(Boolean).join(' · ');

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="flex min-w-0 items-center gap-inline rounded-6 text-left outline-none focus-visible:shadow-button-neutral-focus"
          onClick={() => onSelect?.(event.id)}
          aria-label={`Open details for ${fullEventLabel}`}
        >
          <TriggerSourceIcon
            provider={event.provider}
            source={event.source}
            aria-hidden="true"
            className="size-16 shrink-0 text-foreground-neutral-muted"
          />
          <Code as="span" variant="label" className="truncate text-foreground-neutral-base">
            {eventLabel}
          </Code>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <Code as="span" variant="label" className="block max-w-[360px] break-words">
          {fullEventLabel}
        </Code>
      </TooltipContent>
    </Tooltip>
  );
}
