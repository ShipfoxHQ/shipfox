import type {
  RerunMode,
  RerunRunBodyDto,
  RunAttemptsResponseDto,
  RunDetailResponseDto,
  RunDto,
  RunListResponseDto,
  RunResponseDto,
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
import {
  isWorkflowRunTerminal,
  toWorkflowRun,
  toWorkflowRunAttempt,
  toWorkflowRunDetail,
  toWorkflowRunListPage,
  type WorkflowRun,
  type WorkflowRunAttempt,
  type WorkflowRunDetail,
  type WorkflowRunListPage,
  type WorkflowRunStatus,
} from '#core/workflow-run.js';

export interface WorkflowRunFilters {
  status?: WorkflowRunStatus | undefined;
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
  attempts: (rootRunId: string) => [...workflowRunsQueryKeys.all, 'attempts', rootRunId] as const,
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

async function listWorkflowRunsDto({
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

const ACTIVE_POLL_MS = 4_000;
const IDLE_POLL_MS = 30_000;

function toWorkflowRunInfiniteData(
  data: InfiniteData<RunListResponseDto, string | undefined>,
): InfiniteData<WorkflowRunListPage, string | undefined> {
  return {
    ...data,
    pages: data.pages.map(toWorkflowRunListPage),
  };
}

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
      listWorkflowRunsDto({projectId: projectId ?? '', filters, limit, cursor: pageParam, signal}),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    select: toWorkflowRunInfiniteData,
    placeholderData: keepPreviousData,
    staleTime: 2_000,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data || data.pages.length > 1) return false;
      const hasActive = data.pages.some((page) =>
        page.runs.some((run) => !isWorkflowRunTerminal(run.status)),
      );
      return hasActive ? ACTIVE_POLL_MS : IDLE_POLL_MS;
    },
    refetchIntervalInBackground: false,
  });
}

async function getWorkflowRunDto({runId, signal}: {runId: string; signal?: AbortSignal}) {
  return await apiRequest<RunDetailResponseDto>(`/workflows/runs/${runId}`, {signal});
}

async function getWorkflowRunAttemptsDto({runId, signal}: {runId: string; signal?: AbortSignal}) {
  return await apiRequest<RunAttemptsResponseDto>(`/workflows/runs/${runId}/attempts`, {signal});
}

async function cancelWorkflowRunDto({runId}: {runId: string}) {
  return await apiRequest<RunDto>(`/workflows/runs/${runId}/cancel`, {method: 'POST'});
}

export async function rerunWorkflowRun({runId, mode}: {runId: string; mode: RerunMode}) {
  return await apiRequest<RunResponseDto>(`/workflows/runs/${runId}/rerun`, {
    method: 'POST',
    body: {mode} satisfies RerunRunBodyDto,
  });
}

export function useRerunWorkflowRunMutation(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: rerunWorkflowRun,
    onSuccess: async (run, variables) => {
      const rootRunId = run.root_run_id ?? variables.runId;
      await Promise.all([
        queryClient.invalidateQueries({queryKey: workflowRunsQueryKeys.lists(projectId)}),
        queryClient.invalidateQueries({queryKey: workflowRunsQueryKeys.detail(variables.runId)}),
        queryClient.invalidateQueries({queryKey: workflowRunsQueryKeys.attempts(rootRunId)}),
      ]);
    },
  });
}

export function useWorkflowRunQuery(runId: string | undefined) {
  // Poll a non-terminal run so the open run detail stays live (same cadence as the run
  // list); stop once the run is terminal.
  return useQuery({
    queryKey: runId
      ? workflowRunsQueryKeys.detail(runId)
      : [...workflowRunsQueryKeys.all, 'detail'],
    enabled: Boolean(runId),
    queryFn: ({signal}) => getWorkflowRunDto({runId: runId ?? '', signal}),
    select: toWorkflowRunDetail,
    staleTime: 2_000,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const status: WorkflowRunDetail['status'] | undefined = query.state.data?.status;
      if (!status) return false;
      return isWorkflowRunTerminal(status) ? false : ACTIVE_POLL_MS;
    },
    refetchIntervalInBackground: false,
  });
}

export function useWorkflowRunAttemptsQuery({
  runId,
  rootRunId,
  enabled,
}: {
  runId: string | undefined;
  rootRunId?: string | null | undefined;
  enabled: boolean;
}) {
  const cacheRootRunId = rootRunId ?? runId ?? '';

  return useQuery({
    queryKey: cacheRootRunId
      ? workflowRunsQueryKeys.attempts(cacheRootRunId)
      : [...workflowRunsQueryKeys.all, 'attempts'],
    enabled: Boolean(runId) && enabled,
    queryFn: ({signal}) => getWorkflowRunAttemptsDto({runId: runId ?? '', signal}),
    select: (dto): WorkflowRunAttempt[] => dto.attempts.map(toWorkflowRunAttempt),
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });
}

export function useCancelWorkflowRunMutation(run: WorkflowRun | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!run) throw new Error('Workflow run is not loaded');
      return toWorkflowRun(await cancelWorkflowRunDto({runId: run.id}));
    },
    onSuccess: async () => {
      if (!run) return;
      await Promise.all([
        queryClient.invalidateQueries({queryKey: workflowRunsQueryKeys.detail(run.id)}),
        queryClient.invalidateQueries({queryKey: workflowRunsQueryKeys.lists(run.projectId)}),
      ]);
    },
  });
}
