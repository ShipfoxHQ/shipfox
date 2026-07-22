export type IntegrationCapability = 'source_control' | 'agent_tools';
export type ConnectionLifecycleStatus = 'active' | 'disabled' | 'error';

export interface IntegrationProvider {
  provider: string;
  displayName: string;
  capabilities: IntegrationCapability[];
}

export interface IntegrationConnection {
  id: string;
  workspaceId: string;
  provider: string;
  externalAccountId: string;
  slug: string;
  displayName: string;
  lifecycleStatus: ConnectionLifecycleStatus;
  capabilities: IntegrationCapability[];
  externalUrl?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface Repository {
  connectionId: string;
  externalRepositoryId: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  visibility: 'public' | 'private' | 'internal' | 'unknown';
  cloneUrl: string;
  htmlUrl: string;
}

export interface RepositoryPage {
  repositories: Repository[];
  nextCursor?: string;
}

export interface WebhookConnection {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  lifecycleStatus: ConnectionLifecycleStatus;
  inboundUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface InstallRedirect {
  installUrl: string;
}

export function hasCapability(
  connection: IntegrationConnection,
  capability: IntegrationCapability,
) {
  return connection.capabilities.includes(capability);
}

export function isUsableConnection(connection: IntegrationConnection) {
  return connection.lifecycleStatus === 'active';
}
