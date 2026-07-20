export type ProvisionerScope = 'installation' | 'workspace';

export interface ProvisionerTokenBase {
  id: string;
  scope: ProvisionerScope;
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

export type ProvisionerToken =
  | (ProvisionerTokenBase & {scope: 'installation'; workspaceId: null})
  | (ProvisionerTokenBase & {scope: 'workspace'; workspaceId: string});

export type ActiveProvisionerToken = ProvisionerToken & {lastSeenAt: Date};
