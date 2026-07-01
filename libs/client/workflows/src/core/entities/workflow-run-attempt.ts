import type {WorkflowRunAttemptDto} from '@shipfox/api-workflows-dto';
import type {WorkflowRunStatus} from './workflow-run.js';

export interface WorkflowRunAttempt {
  id: string;
  workflowRunId: string;
  attempt: number;
  status: WorkflowRunStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  rerunMode: 'all' | 'failed' | null;
}

export function toWorkflowRunAttempt(dto: WorkflowRunAttemptDto): WorkflowRunAttempt {
  return {
    id: dto.id,
    workflowRunId: dto.workflow_run_id,
    attempt: dto.attempt,
    status: dto.status,
    createdAt: dto.created_at,
    startedAt: dto.started_at ?? null,
    finishedAt: dto.finished_at ?? null,
    rerunMode: dto.rerun_mode,
  };
}
