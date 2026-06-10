import type {
  LocalWorkflowDetailDto,
  LocalWorkflowListDto,
  LocalWorkflowRunDetailDto,
  LocalWorkflowRunListDto,
  LocalWorkflowStatusDto,
  TriggerFakeAlertBodyDto,
  TriggerFakeAlertResponseDto,
} from '@shipfox/api-local-workflows-dto';
import {apiRequest} from '@shipfox/client-api';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

export const localWorkflowsQueryKeys = {
  all: ['local-workflows'] as const,
  status: (projectId: string) => [...localWorkflowsQueryKeys.all, 'status', projectId] as const,
  workflows: (projectId: string) =>
    [...localWorkflowsQueryKeys.all, 'workflows', projectId] as const,
  workflow: (projectId: string, workflowId: string) =>
    [...localWorkflowsQueryKeys.workflows(projectId), workflowId] as const,
  runs: (projectId: string) => [...localWorkflowsQueryKeys.all, 'runs', projectId] as const,
  run: (projectId: string, runId: string) =>
    [...localWorkflowsQueryKeys.runs(projectId), runId] as const,
};

function projectPath(projectId: string, suffix: string): string {
  return `/local-workflows/projects/${projectId}${suffix}`;
}

export function isTerminalLocalWorkflowRunStatus(status: string | undefined): boolean {
  return (
    status === 'completed' ||
    status === 'runner_failed' ||
    status === 'source_invalid' ||
    status === 'input_rejected'
  );
}

export function localWorkflowRunsRefetchInterval(
  data: LocalWorkflowRunListDto | undefined,
): number {
  if (!data) return 4_000;
  return data.runs.some((run) => !isTerminalLocalWorkflowRunStatus(run.status)) ? 4_000 : 30_000;
}

export async function getLocalWorkflowStatus({
  projectId,
  signal,
}: {
  projectId: string;
  signal?: AbortSignal;
}) {
  return await apiRequest<LocalWorkflowStatusDto>(projectPath(projectId, '/status'), {signal});
}

export async function listLocalWorkflows({
  projectId,
  signal,
}: {
  projectId: string;
  signal?: AbortSignal;
}) {
  return await apiRequest<LocalWorkflowListDto>(projectPath(projectId, '/workflows'), {signal});
}

export async function getLocalWorkflow({
  projectId,
  workflowId,
  signal,
}: {
  projectId: string;
  workflowId: string;
  signal?: AbortSignal;
}) {
  return await apiRequest<LocalWorkflowDetailDto>(
    projectPath(projectId, `/workflows/${encodeURIComponent(workflowId)}`),
    {signal},
  );
}

export async function listLocalWorkflowRuns({
  projectId,
  signal,
}: {
  projectId: string;
  signal?: AbortSignal;
}) {
  return await apiRequest<LocalWorkflowRunListDto>(projectPath(projectId, '/runs'), {signal});
}

export async function getLocalWorkflowRun({
  projectId,
  runId,
  signal,
}: {
  projectId: string;
  runId: string;
  signal?: AbortSignal;
}) {
  return await apiRequest<LocalWorkflowRunDetailDto>(
    projectPath(projectId, `/runs/${encodeURIComponent(runId)}`),
    {signal},
  );
}

export async function triggerLocalWorkflowFakeAlert({
  projectId,
  body,
}: {
  projectId: string;
  body: TriggerFakeAlertBodyDto;
}) {
  return await apiRequest<TriggerFakeAlertResponseDto>(projectPath(projectId, '/fake-alerts'), {
    method: 'POST',
    body,
  });
}

export function useLocalWorkflowStatusQuery(projectId: string | undefined) {
  return useQuery({
    queryKey: projectId
      ? localWorkflowsQueryKeys.status(projectId)
      : [...localWorkflowsQueryKeys.all, 'status'],
    enabled: Boolean(projectId),
    queryFn: ({signal}) => getLocalWorkflowStatus({projectId: projectId ?? '', signal}),
    staleTime: 2_000,
  });
}

export function useLocalWorkflowsQuery(projectId: string | undefined) {
  return useQuery({
    queryKey: projectId
      ? localWorkflowsQueryKeys.workflows(projectId)
      : [...localWorkflowsQueryKeys.all, 'workflows'],
    enabled: Boolean(projectId),
    queryFn: ({signal}) => listLocalWorkflows({projectId: projectId ?? '', signal}),
    staleTime: 2_000,
  });
}

export function useLocalWorkflowQuery(
  projectId: string | undefined,
  workflowId: string | undefined,
) {
  return useQuery({
    queryKey:
      projectId && workflowId
        ? localWorkflowsQueryKeys.workflow(projectId, workflowId)
        : [...localWorkflowsQueryKeys.all, 'workflow'],
    enabled: Boolean(projectId && workflowId),
    queryFn: ({signal}) =>
      getLocalWorkflow({projectId: projectId ?? '', workflowId: workflowId ?? '', signal}),
    staleTime: 2_000,
  });
}

export function useLocalWorkflowRunsQuery(projectId: string | undefined) {
  return useQuery({
    queryKey: projectId
      ? localWorkflowsQueryKeys.runs(projectId)
      : [...localWorkflowsQueryKeys.all, 'runs'],
    enabled: Boolean(projectId),
    queryFn: ({signal}) => listLocalWorkflowRuns({projectId: projectId ?? '', signal}),
    refetchInterval: (query) => localWorkflowRunsRefetchInterval(query.state.data),
    refetchIntervalInBackground: false,
    staleTime: 1_000,
  });
}

export function useLocalWorkflowRunQuery(projectId: string | undefined, runId: string | undefined) {
  return useQuery({
    queryKey:
      projectId && runId
        ? localWorkflowsQueryKeys.run(projectId, runId)
        : [...localWorkflowsQueryKeys.all, 'run'],
    enabled: Boolean(projectId && runId),
    queryFn: ({signal}) =>
      getLocalWorkflowRun({projectId: projectId ?? '', runId: runId ?? '', signal}),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return isTerminalLocalWorkflowRunStatus(status) ? false : 4_000;
    },
    refetchIntervalInBackground: false,
    staleTime: 1_000,
  });
}

export function useTriggerLocalWorkflowFakeAlertMutation(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: TriggerFakeAlertBodyDto) => triggerLocalWorkflowFakeAlert({projectId, body}),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({queryKey: localWorkflowsQueryKeys.runs(projectId)});
      void queryClient.invalidateQueries({
        queryKey: localWorkflowsQueryKeys.run(projectId, data.run_id),
      });
      void queryClient.invalidateQueries({queryKey: localWorkflowsQueryKeys.status(projectId)});
    },
  });
}
