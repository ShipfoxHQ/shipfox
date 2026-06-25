import type {
  TriggerEventDetailResponseDto,
  TriggerEventFacetsResponseDto,
  TriggerEventListResponseDto,
  TriggerEventOutcomeDto,
} from '@shipfox/api-triggers-dto';
import {apiRequest} from '@shipfox/client-api';
import {keepPreviousData, useInfiniteQuery, useQuery} from '@tanstack/react-query';

export interface TriggerEventFilters {
  source?: string[] | undefined;
  event?: string[] | undefined;
  outcome?: TriggerEventOutcomeDto[] | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

function normalizeStringFilter(values: readonly string[] | undefined) {
  return values && values.length > 0 ? [...new Set(values)].sort() : null;
}

function normalizeTriggerEventFiltersForQueryKey(filters: TriggerEventFilters) {
  return {
    source: normalizeStringFilter(filters.source),
    event: normalizeStringFilter(filters.event),
    outcome: normalizeStringFilter(filters.outcome),
    from: filters.from ?? null,
    to: filters.to ?? null,
  };
}

function setListParam(
  params: URLSearchParams,
  name: string,
  values: readonly string[] | undefined,
) {
  const normalized = normalizeStringFilter(values);
  if (normalized) params.set(name, normalized.join(','));
}

export const triggerEventsQueryKeys = {
  all: ['trigger-events'] as const,
  lists: (workspaceId: string) => [...triggerEventsQueryKeys.all, 'list', workspaceId] as const,
  list: (workspaceId: string, filters: TriggerEventFilters, limit = 50) =>
    [
      ...triggerEventsQueryKeys.lists(workspaceId),
      limit,
      normalizeTriggerEventFiltersForQueryKey(filters),
    ] as const,
  detail: (id: string) => [...triggerEventsQueryKeys.all, 'detail', id] as const,
  facets: (workspaceId: string) => [...triggerEventsQueryKeys.all, 'facets', workspaceId] as const,
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
  setListParam(params, 'source', filters.source);
  setListParam(params, 'event', filters.event);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  setListParam(params, 'outcome', filters.outcome);

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
      ? triggerEventsQueryKeys.list(workspaceId, filters, limit)
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

export async function getTriggerEventFacets({
  workspaceId,
  signal,
}: {
  workspaceId: string;
  signal?: AbortSignal;
}) {
  const params = new URLSearchParams({workspace_id: workspaceId});
  return await apiRequest<TriggerEventFacetsResponseDto>(
    `/trigger-events/facets?${params.toString()}`,
    {signal},
  );
}

export function useTriggerEventFacetsQuery(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceId
      ? triggerEventsQueryKeys.facets(workspaceId)
      : [...triggerEventsQueryKeys.all, 'facets'],
    enabled: Boolean(workspaceId),
    queryFn: ({signal}) => getTriggerEventFacets({workspaceId: workspaceId ?? '', signal}),
    // Distinct values change slowly; avoid refetching on every page mount.
    staleTime: 5 * 60 * 1000,
  });
}
