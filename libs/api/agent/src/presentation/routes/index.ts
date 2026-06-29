import {AUTH_USER} from '@shipfox/api-auth-context';
import type {RouteGroup} from '@shipfox/node-fastify';
import {deleteProviderConfigRoute} from './delete-provider-config.js';
import {listProviderCatalogRoute} from './list-provider-catalog.js';
import {listProviderConfigsRoute} from './list-provider-configs.js';
import {setDefaultProviderRoute} from './set-default-provider.js';
import {updateProviderDefaultModelRoute} from './update-provider-default-model.js';
import {upsertProviderConfigRoute} from './upsert-provider-config.js';

export const agentRoutes: RouteGroup[] = [
  {
    prefix: '/workspaces/:workspaceId/agent',
    auth: AUTH_USER,
    routes: [
      listProviderConfigsRoute,
      upsertProviderConfigRoute,
      updateProviderDefaultModelRoute,
      deleteProviderConfigRoute,
      setDefaultProviderRoute,
    ],
  },
  {
    prefix: '/agent',
    auth: AUTH_USER,
    routes: [listProviderCatalogRoute],
  },
];
