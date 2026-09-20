export interface ConnectNotionInstallationInput {
  workspaceId: string;
  notionWorkspaceId: string;
  workspaceName: string;
  botId: string;
  authorizedByUserId: string;
  tokenExpiresAt?: Date | null | undefined;
  lifecycleStatus?: 'active' | 'disabled' | 'error' | undefined;
  displayName: string;
}
