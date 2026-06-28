export interface Reservation {
  id: string;
  workspaceId: string;
  provisionerId: string;
  requiredLabels: string[];
  count: number;
  createdAt: Date;
  expiresAt: Date;
}
