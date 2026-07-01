import {useMemo} from 'react';
import type {WorkflowRunListItem} from '#core/workflow-run.js';
import {useWorkflowRunsInfiniteQuery} from '#hooks/api/workflow-runs.js';
import type {WorkflowRunListProps} from './types.js';
import {WorkflowRunListView} from './workflow-run-list-view.js';

export function WorkflowRunList({
  workspaceId,
  projectId,
  selectedWorkflowRunId,
  className,
}: WorkflowRunListProps) {
  const query = useWorkflowRunsInfiniteQuery(projectId, {});
  const runs = useMemo<WorkflowRunListItem[]>(
    () => query.data?.pages.flatMap((page) => page.runs) ?? [],
    [query.data],
  );

  return (
    <WorkflowRunListView
      runs={runs}
      query={query}
      workspaceId={workspaceId}
      projectId={projectId}
      selectedWorkflowRunId={selectedWorkflowRunId}
      className={className}
    />
  );
}
