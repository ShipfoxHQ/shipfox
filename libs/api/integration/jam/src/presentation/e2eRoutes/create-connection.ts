import {
  createE2eJamConnectionBodySchema,
  createE2eJamConnectionResponseSchema,
} from '@shipfox/api-integration-jam-dto';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {defineRoute} from '@shipfox/node-fastify';
import {toIntegrationConnectionDto} from '#presentation/dto/integrations.js';

export interface SeedJamConnectionInput {
  workspaceId: string;
  token: string;
  teamId: string;
  userId: string;
  userName: string;
  userEmail?: string | undefined;
  lifecycleStatus?: IntegrationConnection<'jam'>['lifecycleStatus'] | undefined;
}

export interface CreateE2eJamConnectionRouteOptions {
  seedJamConnection: (input: SeedJamConnectionInput) => Promise<IntegrationConnection<'jam'>>;
}

export function createE2eJamConnectionRoute(options: CreateE2eJamConnectionRouteOptions) {
  return defineRoute({
    method: 'POST',
    path: '/jam-connections',
    description: 'Create a synthetic Jam connection for E2E tests.',
    schema: {
      body: createE2eJamConnectionBodySchema,
      response: {201: createE2eJamConnectionResponseSchema},
    },
    handler: async (request, reply) => {
      const body = request.body;
      const connection = await options.seedJamConnection({
        workspaceId: body.workspace_id,
        token: body.token,
        teamId: body.team_id,
        userId: body.user_id,
        userName: body.user_name,
        ...(body.user_email === undefined ? {} : {userEmail: body.user_email}),
        ...(body.lifecycle_status === undefined ? {} : {lifecycleStatus: body.lifecycle_status}),
      });
      reply.code(201);
      return toIntegrationConnectionDto(connection);
    },
  });
}
