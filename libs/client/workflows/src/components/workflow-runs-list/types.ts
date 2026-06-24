import type {QueryLoadErrorQuery} from '@shipfox/client-ui';
import type {WorkflowRun} from '#core/workflow-run.js';

export type RunsListStatusFilter = 'all' | 'failed' | 'running';

export interface WorkflowRunsListProps {
  workspaceId: string;
  projectId: string;
  selectedRunId?: string | undefined;
  className?: string | undefined;
}

export type WorkflowRunsListQuery = QueryLoadErrorQuery & {isPending: boolean};

export interface WorkflowRunsListViewProps {
  runs: WorkflowRun[];
  query: WorkflowRunsListQuery;
  workspaceId: string;
  projectId: string;
  selectedRunId?: string | undefined;
  className?: string | undefined;
}
