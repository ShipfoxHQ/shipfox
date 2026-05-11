import type {
  CreateRunBodyDto,
  RunAggregatesResponseDto,
  RunListResponseDto,
  RunResponseDto,
  RunStatusDto,
  TriggerSourceDto,
} from '@shipfox/api-workflows-dto';
import {apiRequest} from '@shipfox/client-api';
import {
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
  });
}

export function useCreateWorkflowRunMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createWorkflowRun,
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
