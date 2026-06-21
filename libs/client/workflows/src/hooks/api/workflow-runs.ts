import type {
  RunDetailResponseDto,
  RunListResponseDto,
  RunStatusDto,
} from '@shipfox/api-workflows-dto';
import {apiRequest} from '@shipfox/client-api';
import {keepPreviousData, useInfiniteQuery, useQuery} from '@tanstack/react-query';

export interface WorkflowRunFilters {
  status?: RunStatusDto | undefined;
  definitionId?: string | undefined;
  triggerSource?: string | undefined;
  createdFrom?: string | undefined;
  createdTo?: string | undefined;
}

export const workflowRunsQueryKeys = {
  all: ['workflow-runs'] as const,
  lists: (projectId: string) => [...workflowRunsQueryKeys.all, 'list', projectId] as const,
  list: (projectId: string, filters: WorkflowRunFilters) =>
    [...workflowRunsQueryKeys.lists(projectId), normalizeFilters(filters)] as const,
  detail: (runId: string) => [...workflowRunsQueryKeys.all, 'detail', runId] as const,
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

const TERMINAL_RUN_STATUSES = new Set<RunStatusDto>(['succeeded', 'failed', 'cancelled']);
const ACTIVE_POLL_MS = 4_000;
const IDLE_POLL_MS = 30_000;

export function useWorkflowRunsInfiniteQuery(
  projectId: string | undefined,
  filters: WorkflowRunFilters,
  limit = 50,
) {
  // Polling is owned by react-query, not the page. Polling fast (4s) while
  // any non-terminal run is visible covers state transitions; polling slow
  // (30s) when idle covers brand-new external runs (webhook/schedule
  // triggers) without leaving the list stale.
  //
  // We disable polling once the user has loaded more than one page. With
  // cursor pagination the cursor that bounds page 1 was computed from
  // page 0's last row; if a refetch shifts that boundary, a small range
  // of rows can drop into a between-pages gap. Users who scrolled into
  // history opted into "reading mode": pause until they refocus, filter,
  // or scroll back.
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
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data || data.pages.length > 1) return false;
      const hasActive = data.pages.some((page) =>
        page.runs.some((run) => !TERMINAL_RUN_STATUSES.has(run.status)),
      );
      return hasActive ? ACTIVE_POLL_MS : IDLE_POLL_MS;
    },
    refetchIntervalInBackground: false,
  });
}

export async function getWorkflowRun({runId, signal}: {runId: string; signal?: AbortSignal}) {
  return await apiRequest<RunDetailResponseDto>(`/workflows/runs/${runId}`, {signal});
}

export function useWorkflowRunQuery(runId: string | undefined) {
  // Poll a non-terminal run so the open run detail stays live (same cadence as the run
  // list); stop once the run is terminal.
  return useQuery({
    queryKey: runId
      ? workflowRunsQueryKeys.detail(runId)
      : [...workflowRunsQueryKeys.all, 'detail'],
    enabled: Boolean(runId),
    queryFn: ({signal}) => getWorkflowRun({runId: runId ?? '', signal}),
    staleTime: 2_000,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (!status) return false;
      return TERMINAL_RUN_STATUSES.has(status) ? false : ACTIVE_POLL_MS;
    },
    refetchIntervalInBackground: false,
  });
}
