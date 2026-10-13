import {
  cacheCommitBodySchema,
  cacheCommitResponseSchema,
  cacheEntryParamsSchema,
} from '@shipfox/api-cache-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {commitCacheEntry} from '#core/commit-cache-entry.js';
import {type CacheRequestContext, translateCacheError} from './request-context.js';

export function createCommitRoute(context: CacheRequestContext) {
  return defineRoute({
    method: 'POST',
    path: '/entries/:entryId/commit',
    description:
      'Complete the upload of an entry reserved by this job execution. The stored object must match the reserved size. Repeating a commit answers ready.',
    schema: {
      params: cacheEntryParamsSchema,
      body: cacheCommitBodySchema,
      response: {200: cacheCommitResponseSchema},
    },
    errorHandler: translateCacheError,
    handler: async (request) => {
      await commitCacheEntry({
        lease: context.lease(request),
        entryId: request.params.entryId,
        parts: request.body.parts,
      });
      return {status: 'ready' as const};
    },
  });
}
