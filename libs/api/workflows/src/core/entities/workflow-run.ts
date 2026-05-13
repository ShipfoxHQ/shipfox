export type WorkflowRunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type TriggerSource = 'manual' | 'webhook' | 'schedule';

export interface TriggerContext {
  [key: string]: unknown;
}

export interface WorkflowRun {
  id: string;
  workspaceId: string;
  projectId: string;
  definitionId: string;
  name: string;
  status: WorkflowRunStatus;
  triggerSource: TriggerSource;
  triggerContext: TriggerContext;
  inputs: Record<string, unknown> | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
