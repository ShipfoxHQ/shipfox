import {AUTH_USER} from '@shipfox/api-auth-context';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {RouteGroup} from '@shipfox/node-fastify';
import type {WorkspaceStorageLimits} from '#core/storage-policy.js';
import {createDeleteEntryRoute} from './delete-entry.js';
import {createDeleteScopeRoute} from './delete-scope.js';
import {createGetUsageRoute} from './get-usage.js';
import {createListEntriesRoute} from './list-entries.js';
import {createListScopesRoute} from './list-scopes.js';
import {getSettingsRoute, updateSettingsRoute} from './settings.js';

/** The routes members use to see and manage the cache. Entries of other workspaces stay unseen. */
export function createCacheManagementRoutes(params: {
  projects: Pick<ProjectsModuleClient, 'getProjectById'>;
  limits: WorkspaceStorageLimits;
}): RouteGroup[] {
  const {projects, limits} = params;
  return [
    {
      prefix: '/projects/:projectId/cache',
      auth: AUTH_USER,
      routes: [
        createListScopesRoute(projects),
        createListEntriesRoute(projects),
        createDeleteEntryRoute(projects),
        createDeleteScopeRoute(projects),
      ],
    },
    {
      prefix: '/workspaces/:workspaceId/cache',
      auth: AUTH_USER,
      routes: [createGetUsageRoute(limits), getSettingsRoute, updateSettingsRoute],
    },
  ];
}
