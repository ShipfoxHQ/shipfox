import type {
  CreateRunBodyDto,
  RunAggregatesResponseDto,
  RunDto,
  RunListResponseDto,
  RunResponseDto,
  RunStatusDto,
  TriggerSourceDto,
} from '@shipfox/api-workflows-dto';
import {apiRequest} from '@shipfox/client-api';
import {
  type InfiniteData,
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

export interface WorkflowRunFilters {
  status?: RunStatusDto | undefined;
  definitionId?: string | undefined;
  triggerSource?: TriggerSourceDto | undefined;
  createdFrom?: string | undefined;
  createdTo?: string | undefined;
}

export const workflowRunsQueryKeys = {
  all: ['workflow-runs'] as const,
  lists: (projectId: string) => [...workflowRunsQueryKeys.all, 'list', projectId] as const,
  list: (projectId: string, filters: WorkflowRunFilters) =>
    [...workflowRunsQueryKeys.lists(projectId), normalizeFilters(filters)] as const,
  aggregates: (projectId: string, filters: WorkflowRunFilters) =>
    [...workflowRunsQueryKeys.all, 'aggregates', projectId, normalizeFilters(filters)] as const,
};

function normalizeFilters(filters: WorkflowRunFilters) {
  return {
    status: filters.status ?? null,
    definitionId: filters.definitionId ?? null,
    triggerSource: filters.triggerSource ?? null,
    createdFrom: filters.createdFrom ?? null,
    createdTo: filters.createdTo ?? null,
  };
}

function appendFilters(params: URLSearchParams, filters: WorkflowRunFilters) {
  if (filters.status) params.set('status', filters.status);
  if (filters.definitionId) params.set('definition_id', filters.definitionId);
  if (filters.triggerSource) params.set('trigger_source', filters.triggerSource);
  if (filters.createdFrom) params.set('created_from', filters.createdFrom);
  if (filters.createdTo) params.set('created_to', filters.createdTo);
}

export async function listWorkflowRuns({
  projectId,
  filters,
  limit = 50,
  cursor,
  signal,
}: {
  projectId: string;
  filters: WorkflowRunFilters;
  limit?: number;
  cursor?: string | undefined;
  signal?: AbortSignal;
}) {
  const params = new URLSearchParams({project_id: projectId, limit: String(limit)});
  if (cursor) params.set('cursor', cursor);
  appendFilters(params, filters);
  return await apiRequest<RunListResponseDto>(`/workflows/runs?${params.toString()}`, {signal});
}

export async function getWorkflowRunAggregates({
  projectId,
  filters,
  signal,
}: {
  projectId: string;
  filters: WorkflowRunFilters;
  signal?: AbortSignal;
}) {
  const params = new URLSearchParams({project_id: projectId});
  appendFilters(params, filters);
  return await apiRequest<RunAggregatesResponseDto>(
    `/workflows/runs/aggregates?${params.toString()}`,
    {
      signal,
    },
  );
}

export async function createWorkflowRun(body: CreateRunBodyDto) {
  return await apiRequest<RunResponseDto>('/workflows/runs', {method: 'POST', body});
}

export function useWorkflowRunsInfiniteQuery(
  projectId: string | undefined,
  filters: WorkflowRunFilters,
  limit = 50,
) {
  // staleTime of 2s deduplicates with the page-local 4s active poller;
  // refetchOnWindowFocus keeps the list current after tab switches without
  // a global QueryClient change (AuthProvider already focus-refreshes auth).
  return useInfiniteQuery({
    queryKey: projectId
      ? workflowRunsQueryKeys.list(projectId, filters)
      : [...workflowRunsQueryKeys.all, 'list'],
    enabled: Boolean(projectId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({pageParam, signal}) =>
      listWorkflowRuns({projectId: projectId ?? '', filters, limit, cursor: pageParam, signal}),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
    staleTime: 2_000,
    refetchOnWindowFocus: true,
  });
}

export function useWorkflowRunAggregatesQuery(
  projectId: string | undefined,
  filters: WorkflowRunFilters,
) {
  return useQuery({
    queryKey: projectId
      ? workflowRunsQueryKeys.aggregates(projectId, filters)
      : [...workflowRunsQueryKeys.all, 'aggregates'],
    enabled: Boolean(projectId),
    queryFn: ({signal}) => getWorkflowRunAggregates({projectId: projectId ?? '', filters, signal}),
    staleTime: 2_000,
    refetchOnWindowFocus: true,
  });
}

type RunListPage = {
  runs: RunDto[];
  next_cursor: string | null;
  filtered_total_count: number | null;
};

type RunListInfinite = InfiniteData<RunListPage>;

/**
 * Filter-aware optimistic insertion of a fresh manual `pending` run.
 *
 * react-query keeps one cache per filter combination. Inserting into "all"
 * lists would briefly show a `pending` row inside a `?status=failed` view,
 * which lies until the next poll evicts it. Inserting only into the
 * unfiltered list loses the "I just kicked off a run" magic on filtered
 * views. Filter-aware insertion is the engineered-enough answer: walk every
 * cached list for the project, check whether each filter combination would
 * accept this run, insert into the ones that do.
 *
 * The temp row carries `id = "temp-<uuid>"`, `status = "pending"`,
 * `trigger_source = "manual"`. It is replaced by the real row on the next
 * list invalidation (which `onSuccess` triggers).
 */
function filtersAcceptManualPendingRun(
  filters: WorkflowRunFilters,
  definitionId: string,
  now: Date,
): boolean {
  if (filters.status && filters.status !== 'pending') return false;
  if (filters.definitionId && filters.definitionId !== definitionId) return false;
  if (filters.triggerSource && filters.triggerSource !== 'manual') return false;
  if (filters.createdFrom && Date.parse(filters.createdFrom) > now.getTime()) return false;
  if (filters.createdTo && Date.parse(filters.createdTo) < now.getTime()) return false;
  return true;
}

function buildTempRun({
  projectId,
  definitionId,
  name,
  createdAt,
}: {
  projectId: string;
  definitionId: string;
  name: string;
  createdAt: string;
}): RunDto {
  return {
    id: `temp-${cryptoRandomId()}`,
    project_id: projectId,
    definition_id: definitionId,
    name,
    status: 'pending',
    trigger_source: 'manual',
    trigger_context: {},
    inputs: null,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useCreateWorkflowRunMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createWorkflowRun,
    onMutate: (body) => {
      // Resolve the display name from the definitions cache if we have it.
      // Falling back to "New run" is honest — the canonical row arrives via
      // the post-success invalidate within the second.
      const definitionName = lookupDefinitionName(queryClient, body.project_id, body.definition_id);
      const createdAt = new Date().toISOString();
      const tempRun = buildTempRun({
        projectId: body.project_id,
        definitionId: body.definition_id,
        name: definitionName ?? 'New run',
        createdAt,
      });

      const listsKey = workflowRunsQueryKeys.lists(body.project_id);
      const snapshots: Array<[readonly unknown[], RunListInfinite | undefined]> = [];

      const entries = queryClient.getQueriesData<RunListInfinite>({queryKey: listsKey});
      const now = new Date(createdAt);
      for (const [queryKey, data] of entries) {
        const filters = readFiltersFromKey(queryKey);
        if (!filters) continue;
        if (!filtersAcceptManualPendingRun(filters, body.definition_id, now)) continue;

        snapshots.push([queryKey, data]);
        queryClient.setQueryData<RunListInfinite>(queryKey, (current) => {
          if (!current || current.pages.length === 0) return current;
          const firstPage = current.pages[0];
          if (!firstPage) return current;
          const nextFirstPage: RunListPage = {
            ...firstPage,
            runs: [tempRun, ...firstPage.runs],
            filtered_total_count:
              firstPage.filtered_total_count != null ? firstPage.filtered_total_count + 1 : null,
          };
          return {...current, pages: [nextFirstPage, ...current.pages.slice(1)]};
        });
      }

      return {snapshots};
    },
    onError: (_error, _body, context) => {
      // Roll back every list we touched.
      if (!context) return;
      for (const [queryKey, previous] of context.snapshots) {
        queryClient.setQueryData(queryKey, previous);
      }
    },
    onSuccess: (_data, body) => {
      void queryClient.invalidateQueries({
        queryKey: workflowRunsQueryKeys.lists(body.project_id),
      });
      void queryClient.invalidateQueries({
        queryKey: [...workflowRunsQueryKeys.all, 'aggregates', body.project_id],
      });
    },
  });
}

/**
 * Read filters off a cached list query key.
 *
 * The list key is `['workflow-runs', 'list', projectId, normalizedFilters]`.
 * Anything else (e.g. the placeholder key for an undefined project) is
 * skipped so we don't try to insert into the wrong cache.
 */
function readFiltersFromKey(queryKey: readonly unknown[]): WorkflowRunFilters | null {
  if (queryKey.length < 4) return null;
  const normalized = queryKey[3];
  if (!normalized || typeof normalized !== 'object') return null;
  const obj = normalized as Record<string, unknown>;
  return {
    status: (obj.status as RunStatusDto | null) ?? undefined,
    definitionId: (obj.definitionId as string | null) ?? undefined,
    triggerSource: (obj.triggerSource as TriggerSourceDto | null) ?? undefined,
    createdFrom: (obj.createdFrom as string | null) ?? undefined,
    createdTo: (obj.createdTo as string | null) ?? undefined,
  };
}

/**
 * Best-effort lookup of the workflow display name from the definitions
 * infinite query cache (any filter scope). If we can't find it, the
 * mutation fallback name is used — the canonical row arrives within
 * the next invalidation cycle.
 */
function lookupDefinitionName(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
  definitionId: string,
): string | undefined {
  const entries = queryClient.getQueriesData<
    InfiniteData<{definitions: Array<{id: string; project_id: string; name: string}>}>
  >({queryKey: ['definitions', 'list', projectId]});
  for (const [, data] of entries) {
    if (!data) continue;
    for (const page of data.pages) {
      const match = page.definitions.find((d) => d.id === definitionId);
      if (match) return match.name;
    }
  }
  return undefined;
}
