import {requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {cacheUsageResponseSchema, cacheWorkspaceParamsSchema} from '@shipfox/api-cache-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {getCacheUsage} from '#core/get-cache-usage.js';
import type {WorkspaceStorageLimits} from '#core/storage-policy.js';
import {toCacheUsageDto} from '#presentation/dto/management.js';

export function createGetUsageRoute(limits: WorkspaceStorageLimits) {
  return defineRoute({
    method: 'GET',
    path: '/usage',
    description:
      'Stored bytes of a workspace, its limit, totals per project, and the latest deletions. It reads the current entries, not usage records.',
    schema: {
      params: cacheWorkspaceParamsSchema,
      response: {200: cacheUsageResponseSchema},
    },
    handler: async (request) => {
      const {workspaceId} = request.params;
      requireWorkspaceAccess({request, workspaceId});

      return toCacheUsageDto(await getCacheUsage({workspaceId, limits}));
    },
  });
}
