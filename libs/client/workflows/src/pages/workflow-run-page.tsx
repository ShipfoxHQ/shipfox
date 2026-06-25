import {useNavigate, useSearch} from '@tanstack/react-router';
import {useCallback, useEffect} from 'react';
import {WorkflowRunView} from '#components/workflow-run-view/index.js';
import {WorkflowRunsList} from '#components/workflow-runs-list/workflow-runs-list.js';
import {
  type WorkflowRunSelectionInput,
  withoutWorkflowRunSelectionSearch,
  withWorkflowRunSelectionSearch,
  workflowRunSelectionFromSearch,
} from '#core/workflow-run-url-state.js';
import {useWorkflowRunsInfiniteQuery} from '#hooks/api/workflow-runs.js';
import {WorkflowRunFirstTimeUse} from './workflow-run-first-time-use.js';

interface WorkflowRunPageProps {
  workspaceId: string;
  projectId: string;
  runId?: string | undefined;
}

/**
 * Resolve which surface the runs path should show from a single read of the runs list:
 * - when opened without a run id, point the URL at the most recent run so the detail pane is
 *   never empty (navigation happens in an effect since it mutates history);
 * - report `hasNoRuns` once the list has loaded with zero runs, so a brand-new project lands
 *   on the first-time-use surface instead of an empty rail and a perpetual detail skeleton.
 */
function useWorkflowRunPageTarget(
  workspaceId: string,
  projectId: string,
  runId: string | undefined,
) {
  const navigate = useNavigate();
  const {data, isPending} = useWorkflowRunsInfiniteQuery(projectId, {});
  const firstRunId = data?.pages[0]?.runs[0]?.id;
  // Gate on data presence, not `!isError`: a transient refetch error after a prior success
  // keeps `data`, so the redirect (and the no-runs surface) still resolve from it instead of
  // stalling on the rail while active-run polling hits a blip.
  const isLoaded = !isPending && data !== undefined;

  useEffect(() => {
    if (runId || !isLoaded || !firstRunId) return;
    navigate({
      to: '/workspaces/$wid/projects/$pid/runs/$runId',
      params: {wid: workspaceId, pid: projectId, runId: firstRunId},
      search: ((previous: Record<string, unknown>) =>
        withoutWorkflowRunSelectionSearch(previous)) as never,
      replace: true,
    });
  }, [navigate, workspaceId, projectId, runId, isLoaded, firstRunId]);

  return {hasNoRuns: isLoaded && firstRunId === undefined};
}

export function WorkflowRunPage({workspaceId, projectId, runId}: WorkflowRunPageProps) {
  const {hasNoRuns} = useWorkflowRunPageTarget(workspaceId, projectId, runId);
  const navigate = useNavigate();
  const search = useSearch({strict: false}) as Record<string, unknown>;
  const selection = workflowRunSelectionFromSearch(search);
  const onSelectionChange = useCallback(
    (nextSelection: WorkflowRunSelectionInput) => {
      navigate({
        search: ((previous: Record<string, unknown>) =>
          withWorkflowRunSelectionSearch(previous, nextSelection)) as never,
      });
    },
    [navigate],
  );

  if (!runId && hasNoRuns) {
    return <WorkflowRunFirstTimeUse />;
  }

  return (
    <div className="flex min-h-0 flex-1">
      <WorkflowRunsList workspaceId={workspaceId} projectId={projectId} selectedRunId={runId} />
      <WorkflowRunView runId={runId} selection={selection} onSelectionChange={onSelectionChange} />
    </div>
  );
}
