import type {
  TriggerEventDetailResponseDto,
  TriggerEventListResponseDto,
  TriggerEventOutcomeDto,
} from '@shipfox/api-triggers-dto';
import {apiRequest} from '@shipfox/client-api';
import {keepPreviousData, useInfiniteQuery, useQuery} from '@tanstack/react-query';

export interface TriggerEventFilters {
  source?: string | undefined;
  event?: string | undefined;
  outcome?: TriggerEventOutcomeDto[] | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

function normalizeTriggerEventFiltersForQueryKey(filters: TriggerEventFilters) {
  const outcome =
    filters.outcome && filters.outcome.length > 0 ? [...new Set(filters.outcome)].sort() : null;
  return {
    source: filters.source ?? null,
    event: filters.event ?? null,
    outcome,
    from: filters.from ?? null,
    to: filters.to ?? null,
  };
}

export const triggerEventsQueryKeys = {
  all: ['trigger-events'] as const,
  lists: (workspaceId: string) => [...triggerEventsQueryKeys.all, 'list', workspaceId] as const,
  list: (workspaceId: string, filters: TriggerEventFilters) =>
    [
      ...triggerEventsQueryKeys.lists(workspaceId),
      normalizeTriggerEventFiltersForQueryKey(filters),
    ] as const,
  detail: (id: string) => [...triggerEventsQueryKeys.all, 'detail', id] as const,
};

export async function listTriggerEvents({
  workspaceId,
  filters = {},
  limit = 50,
  cursor,
  signal,
}: {
  workspaceId: string;
  filters?: TriggerEventFilters;
  limit?: number;
  cursor?: string | undefined;
  signal?: AbortSignal;
}) {
  const params = new URLSearchParams({workspace_id: workspaceId, limit: String(limit)});
  if (cursor) params.set('cursor', cursor);
  if (filters.source) params.set('source', filters.source);
  if (filters.event) params.set('event', filters.event);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.outcome && filters.outcome.length > 0) {
    params.set('outcome', [...new Set(filters.outcome)].sort().join(','));
  }

  return await apiRequest<TriggerEventListResponseDto>(`/trigger-events?${params.toString()}`, {
    signal,
  });
}

export async function getTriggerEvent({id, signal}: {id: string; signal?: AbortSignal}) {
  return await apiRequest<TriggerEventDetailResponseDto>(
    `/trigger-events/${encodeURIComponent(id)}`,
    {signal},
  );
}

export function useTriggerEventsInfiniteQuery(
  workspaceId: string | undefined,
  filters: TriggerEventFilters = {},
  limit = 50,
) {
  return useInfiniteQuery({
    queryKey: workspaceId
      ? triggerEventsQueryKeys.list(workspaceId, filters)
      : [...triggerEventsQueryKeys.all, 'list'],
    enabled: Boolean(workspaceId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({pageParam, signal}) =>
      listTriggerEvents({
        workspaceId: workspaceId ?? '',
        filters,
        limit,
        cursor: pageParam,
        signal,
      }),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useTriggerEventQuery(id: string | undefined) {
  return useQuery({
    queryKey: id ? triggerEventsQueryKeys.detail(id) : [...triggerEventsQueryKeys.all, 'detail'],
    enabled: Boolean(id),
    queryFn: ({signal}) => getTriggerEvent({id: id ?? '', signal}),
  });
}
