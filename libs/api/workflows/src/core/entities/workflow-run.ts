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

export type TriggerPayload =
  | {
      source: 'manual';
      event: 'fire';
      subscriptionId: string;
      userId: string;
    }
  | {
      source: 'cron';
      event: 'tick';
      scheduleId: string;
    }
  // Integration sources (github, gitlab, sentry, …) flow through opaquely: the
  // run records what fired it and carries the raw event payload, without the
  // triggers module having to know each source's shape.
  | {
      source: string;
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
  triggerSource: string;
  triggerEvent: string;
  triggerPayload: TriggerPayload;
  inputs: Record<string, unknown> | null;
  triggerIdempotencyKey: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
