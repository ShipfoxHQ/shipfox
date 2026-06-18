import {useNavigate} from '@tanstack/react-router';
import {useEffect} from 'react';
import {WorkflowRunView} from '#components/workflow-run-view/index.js';
import {WorkflowRunsList} from '#components/workflow-runs-list/workflow-runs-list.js';
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
  const {data, isPending, isError} = useWorkflowRunsInfiniteQuery(projectId, {});
  const firstRunId = data?.pages[0]?.runs[0]?.id;
  const isLoaded = !isPending && !isError;

  useEffect(() => {
    if (runId || !isLoaded || !firstRunId) return;
    navigate({
      to: '/workspaces/$wid/projects/$pid/runs/$runId',
      params: {wid: workspaceId, pid: projectId, runId: firstRunId},
      replace: true,
    });
  }, [navigate, workspaceId, projectId, runId, isLoaded, firstRunId]);

  return {hasNoRuns: isLoaded && firstRunId === undefined};
}

export function WorkflowRunPage({workspaceId, projectId, runId}: WorkflowRunPageProps) {
  const {hasNoRuns} = useWorkflowRunPageTarget(workspaceId, projectId, runId);

  if (!runId && hasNoRuns) {
    return <WorkflowRunFirstTimeUse />;
  }

  return (
    <div className="flex min-h-0 flex-1">
      <WorkflowRunsList workspaceId={workspaceId} projectId={projectId} selectedRunId={runId} />
      <WorkflowRunView runId={runId} />
    </div>
  );
}
