import {useMemo} from 'react';
import type {WorkflowRunListItem} from '#core/workflow-run.js';
import {useWorkflowRunsInfiniteQuery} from '#hooks/api/workflow-runs.js';
import type {WorkflowRunsListProps} from './types.js';
import {WorkflowRunsListView} from './workflow-runs-list-view.js';

export function WorkflowRunsList({
  workspaceId,
  projectId,
  selectedWorkflowRunId,
  className,
}: WorkflowRunsListProps) {
  const query = useWorkflowRunsInfiniteQuery(projectId, {});
  const runs = useMemo<WorkflowRunListItem[]>(
    () => query.data?.pages.flatMap((page) => page.runs) ?? [],
    [query.data],
  );

  return (
    <WorkflowRunsListView
      runs={runs}
      query={query}
      workspaceId={workspaceId}
      projectId={projectId}
      selectedWorkflowRunId={selectedWorkflowRunId}
      className={className}
    />
  );
}
