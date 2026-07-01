import type {QueryLoadErrorQuery} from '@shipfox/client-ui';
import type {WorkflowRunListItem} from '#core/workflow-run.js';

export type WorkflowRunListStatusFilter = 'all' | 'failed' | 'running';

export interface WorkflowRunListProps {
  workspaceId: string;
  projectId: string;
  selectedWorkflowRunId?: string | undefined;
  className?: string | undefined;
}

export type WorkflowRunListQuery = QueryLoadErrorQuery & {isPending: boolean};

export interface WorkflowRunListViewProps {
  runs: WorkflowRunListItem[];
  query: WorkflowRunListQuery;
  workspaceId: string;
  projectId: string;
  selectedWorkflowRunId?: string | undefined;
  className?: string | undefined;
}
