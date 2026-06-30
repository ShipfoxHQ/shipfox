export type WorkflowRunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type TerminalWorkflowRunStatus = Extract<
  WorkflowRunStatus,
  'succeeded' | 'failed' | 'cancelled'
>;

const TERMINAL_WORKFLOW_RUN_STATUSES = new Set<WorkflowRunStatus>([
  'succeeded',
  'failed',
  'cancelled',
]);

export function isWorkflowRunTerminal(
  status: WorkflowRunStatus,
): status is TerminalWorkflowRunStatus {
  return TERMINAL_WORKFLOW_RUN_STATUSES.has(status);
}

export interface WorkflowSourceSnapshot {
  content: string;
  format: 'yaml';
}

export type TriggerPayload =
  | {
      source: 'manual';
      provider?: 'manual' | undefined;
      event: 'fire';
      subscriptionId: string;
      userId: string;
    }
  | {
      source: 'cron';
      provider?: 'cron' | undefined;
      event: 'tick';
      scheduleId: string;
    }
  // Integration sources (github, gitlab, sentry, …) flow through opaquely: the
  // run records what fired it and carries the raw event payload, without the
  // triggers module having to know each source's shape.
  | {
      source: string;
      provider?: string | undefined;
      event: string;
      deliveryId: string;
      data: unknown;
    };

export interface WorkflowRun {
  id: string;
  workspaceId: string;
  projectId: string;
  definitionId: string;
  name: string;
  status: WorkflowRunStatus;
  sourceRunId: string | null;
  rootRunId: string | null;
  attempt: number;
  rerunMode: 'all' | 'failed' | null;
  rerunByUserId: string | null;
  triggerSource: string;
  triggerEvent: string;
  triggerPayload: TriggerPayload;
  inputs: Record<string, unknown> | null;
  sourceSnapshot: WorkflowSourceSnapshot | null;
  triggerIdempotencyKey: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface RunAttemptSummary {
  id: string;
  attempt: number;
  status: WorkflowRunStatus;
  createdAt: Date;
  rerunMode: 'all' | 'failed' | null;
}
