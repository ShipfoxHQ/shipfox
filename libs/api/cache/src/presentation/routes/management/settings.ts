import {requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {
  cacheSettingsResponseSchema,
  cacheWorkspaceParamsSchema,
  updateCacheSettingsBodySchema,
} from '@shipfox/api-cache-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {getWorkspaceRetention, setWorkspaceRetention} from '#core/workspace-retention.js';
import {toCacheSettingsDto} from '#presentation/dto/management.js';
import {requireWorkspaceAdmin, translateManagementError} from '#presentation/management-access.js';

export const getSettingsRoute = defineRoute({
  method: 'GET',
  path: '/settings',
  description: 'Get the cache retention of a workspace.',
  schema: {
    params: cacheWorkspaceParamsSchema,
    response: {200: cacheSettingsResponseSchema},
  },
  handler: async (request) => {
    const {workspaceId} = request.params;
    requireWorkspaceAccess({request, workspaceId});

    return toCacheSettingsDto(await getWorkspaceRetention(workspaceId));
  },
});

export const updateSettingsRoute = defineRoute({
  method: 'PUT',
  path: '/settings',
  description:
    'Set the days a cache entry is kept after its last use. Workspace admins only. A shorter value applies at the next sweep.',
  schema: {
    params: cacheWorkspaceParamsSchema,
    body: updateCacheSettingsBodySchema,
    response: {200: cacheSettingsResponseSchema},
  },
  errorHandler: translateManagementError,
  handler: async (request) => {
    const {workspaceId} = request.params;
    requireWorkspaceAdmin({request, workspaceId});

    const retention = await setWorkspaceRetention({
      workspaceId,
      retentionDays: request.body.retention_days,
    });
    return toCacheSettingsDto(retention);
  },
});
