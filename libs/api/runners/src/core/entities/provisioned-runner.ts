export type ProvisionedRunnerState =
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'failed'
  | 'terminated';

export interface ProvisionedRunner {
  id: string;
  workspaceId: string | null;
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
  startedAt: Date | null;
  stoppingAt: Date | null;
  stoppedAt: Date | null;
  failedAt: Date | null;
  terminatedAt: Date | null;
  reservationReleasedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
