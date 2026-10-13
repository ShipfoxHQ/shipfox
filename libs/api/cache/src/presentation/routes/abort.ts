import {cacheEntryParamsSchema} from '@shipfox/api-cache-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {abortCacheEntry} from '#core/abort-cache-entry.js';
import {type CacheRequestContext, translateCacheError} from './request-context.js';

export function createAbortRoute(context: CacheRequestContext) {
  return defineRoute({
    method: 'DELETE',
    path: '/entries/:entryId',
    description:
      'Abort an upload reserved by this job execution and free its key. An entry that is not an upload of this job execution is left alone.',
    schema: {
      params: cacheEntryParamsSchema,
      response: {204: z.void()},
    },
    errorHandler: translateCacheError,
    handler: async (request, reply) => {
      await abortCacheEntry({
        lease: context.lease(request),
        entryId: request.params.entryId,
      });
      return reply.status(204).send();
    },
  });
}
