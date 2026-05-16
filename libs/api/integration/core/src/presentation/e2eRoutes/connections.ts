import {
  e2eCreateIntegrationConnectionBodySchema,
  e2eCreateIntegrationConnectionResponseSchema,
} from '@shipfox/api-integration-core-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {upsertIntegrationConnection} from '#db/connections.js';

export const createE2eIntegrationConnectionRoute = defineRoute({
  method: 'POST',
  path: '/connections',
  description: 'Seed an integration connection for E2E tests.',
  schema: {
    body: e2eCreateIntegrationConnectionBodySchema,
    response: {
      201: e2eCreateIntegrationConnectionResponseSchema,
    },
  },
  handler: async (request, reply) => {
    const connection = await upsertIntegrationConnection({
      workspaceId: request.body.workspace_id,
      provider: request.body.provider,
      externalAccountId: request.body.external_account_id,
      displayName: request.body.display_name ?? `e2e-${request.body.external_account_id}`,
      lifecycleStatus: request.body.lifecycle_status ?? 'active',
    });

    reply.code(201);
    return {
      connection: {
        id: connection.id,
        workspace_id: connection.workspaceId,
        provider: connection.provider,
        external_account_id: connection.externalAccountId,
        display_name: connection.displayName,
        lifecycle_status: connection.lifecycleStatus,
      },
    };
  },
});
