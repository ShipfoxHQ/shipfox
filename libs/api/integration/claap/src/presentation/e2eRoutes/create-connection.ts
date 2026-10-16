import {
  createE2eClaapConnectionBodySchema,
  createE2eClaapConnectionResponseSchema,
} from '@shipfox/api-integration-claap-dto';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {defineRoute} from '@shipfox/node-fastify';
import {toIntegrationConnectionDto} from '#presentation/dto/integrations.js';

export interface SeedClaapConnectionInput {
  workspaceId: string;
  apiKey: string;
  claapWorkspaceId: string;
  claapWorkspaceName: string;
  lifecycleStatus?: IntegrationConnection<'claap'>['lifecycleStatus'] | undefined;
}

export interface CreateE2eClaapConnectionRouteOptions {
  seedClaapConnection: (input: SeedClaapConnectionInput) => Promise<IntegrationConnection<'claap'>>;
}

export function createE2eClaapConnectionRoute(options: CreateE2eClaapConnectionRouteOptions) {
  return defineRoute({
    method: 'POST',
    path: '/claap-connections',
    description: 'Create a synthetic Claap connection for E2E tests.',
    schema: {
      body: createE2eClaapConnectionBodySchema,
      response: {201: createE2eClaapConnectionResponseSchema},
    },
    handler: async (request, reply) => {
      const body = request.body;
      const connection = await options.seedClaapConnection({
        workspaceId: body.workspace_id,
        apiKey: body.api_key,
        claapWorkspaceId: body.claap_workspace_id,
        claapWorkspaceName: body.claap_workspace_name,
        ...(body.lifecycle_status === undefined ? {} : {lifecycleStatus: body.lifecycle_status}),
      });
      reply.code(201);
      return toIntegrationConnectionDto(connection);
    },
  });
}
