import type {
  TriggerEventFacetsResponseDto,
  TriggerEventListItemDto,
} from '@shipfox/api-triggers-dto';
import type {QueryLoadErrorQuery} from '@shipfox/client-ui';
import type {TriggerEventFilters} from '#hooks/api/trigger-events.js';

export type TriggerEventsListQuery = QueryLoadErrorQuery & {isPending: boolean};

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
