import {
  createDiscordApiClient,
  DiscordAgentToolsProvider,
  type DiscordInstallation,
} from '@shipfox/api-integration-discord';
import type {DiscordContractAccess} from '../fakes/discord.js';

/** The Discord tool adapter, with the fake's server in place of the installation in the database. */
export function discordContractTools(access: DiscordContractAccess): DiscordAgentToolsProvider {
  const now = new Date();
  const installation: DiscordInstallation = {
    id: `contracts-${access.guildId}`,
    connectionId: `contracts-${access.guildId}`,
    guildId: access.guildId,
    guildName: 'Contracts sandbox',
    permissions: '0',
    installedByDiscordUserId: null,
    botRoleId: null,
    status: 'installed',
    generation: 1,
    createdAt: now,
    updatedAt: now,
  };
  return new DiscordAgentToolsProvider({
    discord: createDiscordApiClient(),
    getInstallationByConnectionId: () => Promise.resolve(installation),
  });
}
