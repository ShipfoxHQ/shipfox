import type {RunDto} from '@shipfox/api-workflows-dto';
import type {QueryLoadErrorQuery} from '@shipfox/client-ui';

export type RunsListStatusFilter = 'all' | 'failed' | 'running';

export interface WorkflowRunsListProps {
  projectId: string;
  selectedRunId?: string | undefined;
  className?: string | undefined;
}

export type WorkflowRunsListQuery = QueryLoadErrorQuery & {isPending: boolean};

export interface WorkflowRunsListViewProps {
  runs: RunDto[];
  query: WorkflowRunsListQuery;
  projectId: string;
  selectedRunId?: string | undefined;
  className?: string | undefined;
}
