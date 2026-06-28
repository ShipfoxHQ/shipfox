export type ResourceState = 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';

export interface Resource {
  id: string;
  workspaceId: string;
  provisionerId: string;
  resourceId: string;
  reservationId: string | null;
  templateKey: string | null;
  labels: string[];
  state: ResourceState;
  reason: string | null;
  runnerSessionId: string | null;
  providerKind: string | null;
  reportedAt: Date;
  reservationReleasedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
