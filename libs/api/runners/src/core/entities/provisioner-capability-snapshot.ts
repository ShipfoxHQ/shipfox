export interface ProvisionerCapabilitySnapshot {
  id: string;
  workspaceId: string;
  provisionerId: string;
  templateKey: string;
  labels: string[];
  availableSlots: number;
  starting: number;
  running: number;
  advertisedAt: Date;
  createdAt: Date;
}
