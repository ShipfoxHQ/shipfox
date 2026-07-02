import {AUTH_USER} from '@shipfox/api-auth-context';
import type {RouteGroup} from '@shipfox/node-fastify';
import {deleteModelProviderConfigRoute} from './delete-model-provider-config.js';
import {listModelProviderCatalogRoute} from './list-model-provider-catalog.js';
import {listModelProviderConfigsRoute} from './list-model-provider-configs.js';
import {setDefaultModelProviderRoute} from './set-default-model-provider.js';
import {updateModelProviderDefaultModelRoute} from './update-model-provider-default-model.js';
import {upsertModelProviderConfigRoute} from './upsert-model-provider-config.js';

export const agentRoutes: RouteGroup[] = [
  {
    prefix: '/workspaces/:workspaceId/agent',
    auth: AUTH_USER,
    routes: [
      listModelProviderConfigsRoute,
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
