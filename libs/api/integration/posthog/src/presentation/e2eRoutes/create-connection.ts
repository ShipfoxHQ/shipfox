import {
  createE2ePosthogConnectionBodySchema,
  createE2ePosthogConnectionResponseSchema,
} from '@shipfox/api-integration-posthog-dto';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {defineRoute} from '@shipfox/node-fastify';
import {toIntegrationConnectionDto} from '#presentation/dto/integrations.js';

export interface SeedPosthogConnectionInput {
  workspaceId: string;
  apiKey: string;
  projectId: string;
  projectName: string;
  organizationId: string;
}

export interface CreateE2ePosthogConnectionRouteOptions {
  seedPosthogConnection: (
    input: SeedPosthogConnectionInput,
  ) => Promise<IntegrationConnection<'posthog'>>;
  connectionCapabilities?: readonly [];
}

export function createE2ePosthogConnectionRoute(options: CreateE2ePosthogConnectionRouteOptions) {
  return defineRoute({
    method: 'POST',
    path: '/posthog-connections',
    description: 'Create a synthetic PostHog connection for E2E tests.',
    schema: {
      body: createE2ePosthogConnectionBodySchema,
      response: {201: createE2ePosthogConnectionResponseSchema},
    },
    handler: async (request, reply) => {
      const body = request.body;
      const connection = await options.seedPosthogConnection({
        workspaceId: body.workspace_id,
        apiKey: body.api_key,
        projectId: body.project_id,
        projectName: body.project_name,
        organizationId: body.organization_id,
      });
      reply.code(201);
      return toIntegrationConnectionDto(connection);
    },
  });
}
