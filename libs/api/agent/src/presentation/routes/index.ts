import {AUTH_USER} from '@shipfox/api-auth-context';
import type {RouteGroup} from '@shipfox/node-fastify';
import type {AgentSecretsClient} from '#core/secrets-client.js';
import {createCustomModelProviderRoute} from './create-custom-model-provider.js';
import {createDeleteModelProviderConfigRoute} from './delete-model-provider-config.js';
import {discoverCustomModelProviderModelsRoute} from './discover-custom-model-provider-models.js';
import {createDiscoverCustomModelProviderModelsBySlugRoute} from './discover-custom-model-provider-models-by-slug.js';
import {listModelProviderCatalogRoute} from './list-model-provider-catalog.js';
import {listModelProviderConfigsRoute} from './list-model-provider-configs.js';
import {setDefaultHarnessRoute} from './set-default-harness.js';
import {setDefaultModelProviderRoute} from './set-default-model-provider.js';
import {createUpdateCustomModelProviderRoute} from './update-custom-model-provider.js';
import {updateModelProviderDefaultModelRoute} from './update-model-provider-default-model.js';
import {createUpsertModelProviderConfigRoute} from './upsert-model-provider-config.js';

export function createAgentRoutes(secrets: AgentSecretsClient): RouteGroup[] {
  return [
    {
      prefix: '/workspaces/:workspaceId/agent',
      auth: AUTH_USER,
      routes: [
        listModelProviderConfigsRoute,
        createCustomModelProviderRoute(secrets),
        discoverCustomModelProviderModelsRoute,
        createDiscoverCustomModelProviderModelsBySlugRoute(secrets),
        createUpdateCustomModelProviderRoute(secrets),
        createUpsertModelProviderConfigRoute(secrets),
        updateModelProviderDefaultModelRoute,
        createDeleteModelProviderConfigRoute(secrets),
        setDefaultHarnessRoute,
        setDefaultModelProviderRoute,
      ],
    },
    {
      prefix: '/agent',
      auth: AUTH_USER,
      routes: [listModelProviderCatalogRoute],
    },
  ];
}

export const agentRoutes = createAgentRoutes(undefined as unknown as AgentSecretsClient);
