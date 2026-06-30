import type {WorkflowRunStatus} from './workflow-run.js';

export type RerunMode = 'all' | 'failed';

export interface WorkflowRunAttempt {
  id: string;
  workflowRunId: string;
  attempt: number;
  status: WorkflowRunStatus;
  rerunMode: RerunMode | null;
  rerunByUserId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}
