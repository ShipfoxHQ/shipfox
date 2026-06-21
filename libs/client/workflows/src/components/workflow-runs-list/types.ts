import type {RunDto} from '@shipfox/api-workflows-dto';
import type {QueryLoadErrorQuery} from '@shipfox/client-ui';

export type RunsListStatusFilter = 'all' | 'failed' | 'running';

export interface WorkflowRunsListProps {
  workspaceId: string;
  projectId: string;
  selectedRunId?: string | undefined;
  className?: string | undefined;
}

export type WorkflowRunsListQuery = QueryLoadErrorQuery & {isPending: boolean};

export interface WorkflowRunsListViewProps {
  runs: RunDto[];
  query: WorkflowRunsListQuery;
  workspaceId: string;
  projectId: string;
  selectedRunId?: string | undefined;
  className?: string | undefined;
}
