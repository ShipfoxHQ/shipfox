import {
  createE2eDiscordConnectionBodySchema,
  createE2eDiscordConnectionResponseSchema,
} from '@shipfox/api-integration-discord-dto';
import type {IntegrationCapability, IntegrationConnection} from '@shipfox/api-integration-spi';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import type {ConnectDiscordInstallationInput} from '#core/install.js';
import {toIntegrationConnectionDto} from '#presentation/dto/integrations.js';

export interface CreateE2eDiscordConnectionRouteOptions {
  getExistingDiscordConnection: (input: {
    guildId: string;
  }) => Promise<IntegrationConnection<'discord'> | undefined>;
  connectDiscordInstallation: (
    input: ConnectDiscordInstallationInput,
  ) => Promise<IntegrationConnection<'discord'>>;
  connectionCapabilities: IntegrationCapability[];
}

export function createE2eDiscordConnectionRoute(options: CreateE2eDiscordConnectionRouteOptions) {
  return defineRoute({
    method: 'POST',
    path: '/discord-connections',
    description: 'Create a synthetic Discord connection for E2E tests.',
    schema: {
      body: createE2eDiscordConnectionBodySchema,
      response: {201: createE2eDiscordConnectionResponseSchema},
    },
    handler: async (request, reply) => {
      const body = request.body;
      const workspaceId = body.workspace_id.toLowerCase();
      const existing = await options.getExistingDiscordConnection({guildId: body.guild_id});
      if (existing && existing.workspaceId !== workspaceId) {
        throw new ClientError(
          'Discord server is already connected to another workspace',
          'discord-connection-workspace-mismatch',
          {status: 409},
        );
      }

      const connection = await options.connectDiscordInstallation({
        workspaceId,
        guildId: body.guild_id,
        guildName: body.guild_name,
        permissions: body.permissions,
        botRoleId: body.bot_role_id,
        lifecycleStatus: 'active',
      });

      reply.code(201);
      return toIntegrationConnectionDto(connection, {capabilities: options.connectionCapabilities});
    },
  });
}
