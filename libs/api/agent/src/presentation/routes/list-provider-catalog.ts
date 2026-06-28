import {agentProviderCatalogResponseSchema} from '@shipfox/api-agent-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {buildAgentProviderCatalog} from '#core/index.js';

export const listProviderCatalogRoute = defineRoute({
  method: 'GET',
  path: '/provider-catalog',
  description: 'List available agent providers and models',
  schema: {
    response: {
      200: agentProviderCatalogResponseSchema,
    },
  },
  handler: () => ({providers: buildAgentProviderCatalog()}),
});
