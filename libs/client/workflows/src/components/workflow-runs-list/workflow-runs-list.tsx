import {useMemo} from 'react';
import type {WorkflowRun} from '#core/workflow-run.js';
import {useWorkflowRunsInfiniteQuery} from '#hooks/api/workflow-runs.js';
import type {WorkflowRunsListProps} from './types.js';
import {WorkflowRunsListView} from './workflow-runs-list-view.js';

export function WorkflowRunsList({
  workspaceId,
  projectId,
  selectedRunId,
  className,
}: WorkflowRunsListProps) {
  const query = useWorkflowRunsInfiniteQuery(projectId, {});
  const runs = useMemo<WorkflowRun[]>(
    () => query.data?.pages.flatMap((page) => page.runs) ?? [],
    [query.data],
  );

  return (
    <WorkflowRunsListView
      runs={runs}
      query={query}
      workspaceId={workspaceId}
      projectId={projectId}
      selectedRunId={selectedRunId}
      className={className}
    />
  );
}
