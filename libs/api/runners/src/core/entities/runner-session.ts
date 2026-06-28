export interface RunnerSession {
  id: string;
  workspaceId: string;
  scope: 'workspace';
  registrationTokenId: string;
  registrationTokenKind: 'manual' | 'ephemeral';
  labels: string[];
  maxClaims: number | null;
  claimsUsed: number;
  createdAt: Date;
  updatedAt: Date;
}
