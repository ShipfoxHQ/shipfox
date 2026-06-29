export interface ProvisionerToken {
  id: string;
  workspaceId: string;
  hashedToken: string;
  prefix: string;
  name: string | null;
  createdByUserId: string;
  revokedByUserId: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ActiveProvisionerToken = ProvisionerToken & {lastSeenAt: Date};
