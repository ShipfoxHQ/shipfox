export type WorkflowRunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type TriggerPayload =
  | {
      source: 'manual';
      event: 'fire';
      subscriptionId: string;
      userId: string;
    }
  | {
      source: 'github';
      event: 'push';
      subscriptionId: string;
      deliveryId: string;
      ref: string;
      headCommitSha: string;
      defaultBranch: string;
      isDefaultBranch: boolean;
      externalRepositoryId: string;
    }
  | {
      source: 'cron';
      event: 'tick';
      scheduleId: string;
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
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
