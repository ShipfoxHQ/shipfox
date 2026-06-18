import type {RunDto} from '@shipfox/api-workflows-dto';
import {QueryLoadError} from '@shipfox/client-ui';
import type {WorkflowRunsListQuery} from './types.js';
import {WorkflowRunRowList} from './workflow-run-row.js';
import {
  WorkflowRunsListEmpty,
  WorkflowRunsListNoMatches,
  WorkflowRunsListSkeleton,
  WorkflowRunsListStaleError,
} from './workflow-runs-list-states.js';

interface WorkflowRunsListContentProps {
  query: WorkflowRunsListQuery;
  totalRuns: number;
  runs: RunDto[];
  workspaceId: string;
  projectId: string;
  selectedRunId?: string | undefined;
  onClearFilters: () => void;
}

export function WorkflowRunsListContent({
  query,
  totalRuns,
  runs,
  workspaceId,
  projectId,
  selectedRunId,
  onClearFilters,
}: WorkflowRunsListContentProps) {
  const {isPending, isError} = query;
  // A refetch that fails after a prior success keeps the rows on screen behind a slim
  // banner. QueryLoadError owns the inverse case (errored before anything loaded) and
  // self-gates to nothing here once data exists.
  const refreshFailed = isError && query.data !== undefined;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {isPending ? <WorkflowRunsListSkeleton /> : null}
      {!isPending ? (
        <QueryLoadError query={query} subject="workflow runs" icon="pulseLine" />
      ) : null}
      {!isPending && refreshFailed ? <WorkflowRunsListStaleError query={query} /> : null}
      {!isPending && !isError && totalRuns === 0 ? <WorkflowRunsListEmpty /> : null}
      {!isPending && totalRuns > 0 && runs.length === 0 ? (
        <WorkflowRunsListNoMatches onClear={onClearFilters} />
      ) : null}
      {!isPending && runs.length > 0 ? (
        <WorkflowRunRowList
          runs={runs}
          workspaceId={workspaceId}
          projectId={projectId}
          selectedRunId={selectedRunId}
        />
      ) : null}
    </div>
  );
}
