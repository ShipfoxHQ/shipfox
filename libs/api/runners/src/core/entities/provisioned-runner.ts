export type ProvisionedRunnerState = 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';

export interface ProvisionedRunner {
  id: string;
  workspaceId: string;
  provisionerId: string;
  provisionedRunnerId: string;
  reservationId: string | null;
  templateKey: string | null;
  labels: string[];
  state: ProvisionedRunnerState;
  reason: string | null;
  runnerSessionId: string | null;
  providerKind: string | null;
  reportedAt: Date;
  reservationReleasedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
