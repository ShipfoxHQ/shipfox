import type {
  TriggerEventFacetsResponseDto,
  TriggerEventListItemDto,
} from '@shipfox/api-triggers-dto';
import type {TriggerEventFilters} from '#hooks/api/trigger-events.js';

/**
 * Structural stand-in for the react-query results the list view reads. Decouples the view
 * from react-query's generics so a story can fake the loading/error/stale states. `data`
 * is `undefined` until the first successful fetch (the "errored with nothing loaded" gate).
 */
export interface TriggerEventsListQuery {
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  data: unknown;
  error: unknown;
  refetch: () => unknown;
}

export interface EventsListProps {
  events: TriggerEventListItemDto[];
  query: TriggerEventsListQuery;
  facets: TriggerEventFacetsResponseDto | undefined;
  filters: TriggerEventFilters;
  onFiltersChange: (patch: Partial<TriggerEventFilters>) => void;
  workspaceId: string;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
}
