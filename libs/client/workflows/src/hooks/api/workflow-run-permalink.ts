import {ApiError} from '@shipfox/client-api';
import {getProject} from '@shipfox/client-projects';
import type {WorkspaceSummary} from '@shipfox/client-shell/runtime';
import {queryOptions, type UseQueryOptions, useQuery} from '@tanstack/react-query';
import {
  resolveWorkflowRunPermalink,
  type WorkflowRunPermalinkResolution,
} from '#core/workflow-run-permalink.js';
import {getWorkflowRunLineageHead, getWorkflowRunOverview} from './workflow-run-overview.js';
import {workflowRunsQueryKeys} from './workflow-runs.js';

export interface WorkflowRunPermalinkQueryInput {
  workflowRunId: string | undefined;
  workspaces: readonly WorkspaceSummary[];
  enabled?: boolean | undefined;
}

type WorkflowRunPermalinkQueryKey =
  | readonly ['workflow-runs', 'permalink', string, string]
  | readonly ['workflow-runs', 'permalink'];
type WorkflowRunPermalinkQueryOptions = UseQueryOptions<
  WorkflowRunPermalinkResolution,
  Error,
  WorkflowRunPermalinkResolution,
  WorkflowRunPermalinkQueryKey
>;

export function workflowRunPermalinkQueryOptions({
  workflowRunId,
  workspaces,
  enabled = true,
}: WorkflowRunPermalinkQueryInput): WorkflowRunPermalinkQueryOptions {
  const workspaceSignature = workspaces.map(({id, slug}) => `${id}:${slug}`).join('|');
  return queryOptions({
    queryKey: workflowRunId
      ? ([...workflowRunsQueryKeys.all, 'permalink', workflowRunId, workspaceSignature] as const)
      : ([...workflowRunsQueryKeys.all, 'permalink'] as const),
    enabled: Boolean(workflowRunId) && enabled,
    queryFn: async ({signal}) => {
      try {
        const resolution = await resolveWorkflowRunPermalink({
          workflowRunId: workflowRunId ?? '',
          workspaces,
          readRunOverview: async (runId) => {
            const head = await getWorkflowRunLineageHead(runId, signal);
            const overview = await getWorkflowRunOverview(runId, head.currentAttempt, signal);
            return {projectId: overview.projectId};
          },
          readProject: async (projectId) => getProject(projectId),
        });
        return resolution;
      } catch (error) {
        const resolution = resolutionForApiError(error);
        if (resolution) return resolution;
        throw error;
      }
    },
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export function useWorkflowRunPermalinkQuery(input: WorkflowRunPermalinkQueryInput) {
  return useQuery(workflowRunPermalinkQueryOptions(input));
}

function resolutionForApiError(error: unknown): WorkflowRunPermalinkResolution | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (error.status === 404 || error.code === 'not-found') return {kind: 'not-found'};
  if (error.status === 403 || error.code === 'forbidden') return {kind: 'no-access'};
  return undefined;
}
