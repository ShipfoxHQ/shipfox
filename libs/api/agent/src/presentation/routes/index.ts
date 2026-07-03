import {AUTH_USER} from '@shipfox/api-auth-context';
import type {RouteGroup} from '@shipfox/node-fastify';
import {createCustomModelProviderRoute} from './create-custom-model-provider.js';
import {deleteModelProviderConfigRoute} from './delete-model-provider-config.js';
import {discoverCustomModelProviderModelsRoute} from './discover-custom-model-provider-models.js';
import {listModelProviderCatalogRoute} from './list-model-provider-catalog.js';
import {listModelProviderConfigsRoute} from './list-model-provider-configs.js';
import {setDefaultModelProviderRoute} from './set-default-model-provider.js';
import {updateCustomModelProviderRoute} from './update-custom-model-provider.js';
import {updateModelProviderDefaultModelRoute} from './update-model-provider-default-model.js';
import {upsertModelProviderConfigRoute} from './upsert-model-provider-config.js';

export const agentRoutes: RouteGroup[] = [
  {
    prefix: '/workspaces/:workspaceId/agent',
    auth: AUTH_USER,
    routes: [
      listModelProviderConfigsRoute,
      createCustomModelProviderRoute,
      discoverCustomModelProviderModelsRoute,
      updateCustomModelProviderRoute,
      upsertModelProviderConfigRoute,
      updateModelProviderDefaultModelRoute,
      deleteModelProviderConfigRoute,
      setDefaultModelProviderRoute,
    ],
  },
  {
    prefix: '/agent',
    auth: AUTH_USER,
    routes: [listModelProviderCatalogRoute],
  },
];
