export interface RunnerSession {
  id: string;
  workspaceId: string;
  scope: 'workspace';
  registrationTokenId: string;
  labels: string[];
  createdAt: Date;
  updatedAt: Date;
}
