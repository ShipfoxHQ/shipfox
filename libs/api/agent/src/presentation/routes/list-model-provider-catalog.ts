import {modelProviderCatalogResponseSchema} from '@shipfox/api-agent-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {buildModelProviderCatalog} from '#core/index.js';

export const listModelProviderCatalogRoute = defineRoute({
  method: 'GET',
  path: '/model-provider-catalog',
  description: 'List available model providers and models',
  schema: {
    response: {
      200: modelProviderCatalogResponseSchema,
    },
  },
  handler: () => ({providers: buildModelProviderCatalog()}),
});
