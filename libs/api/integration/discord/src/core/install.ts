export interface ConnectDiscordInstallationInput {
  workspaceId: string;
  guildId: string;
  guildName: string;
  permissions: string;
  installedByDiscordUserId?: string | null | undefined;
  botRoleId?: string | null | undefined;
  displayName?: string | undefined;
  lifecycleStatus?: 'active' | 'error' | undefined;
}
