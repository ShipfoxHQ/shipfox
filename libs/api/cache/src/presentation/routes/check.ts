import {cacheCheckBodySchema, cacheCheckResponseSchema} from '@shipfox/api-cache-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {checkCacheEntry} from '#core/check-cache-entry.js';
import {type CacheRequestContext, translateCacheError} from './request-context.js';

export function createCheckRoute(context: CacheRequestContext) {
  return defineRoute({
    method: 'POST',
    path: '/entries/check',
    description:
      'Tell whether a key is already saved in the scope a save would write, so the save can skip archiving. A hit refreshes the entry.',
    schema: {
      body: cacheCheckBodySchema,
      response: {200: cacheCheckResponseSchema},
    },
    errorHandler: translateCacheError,
    handler: async (request) => {
      const body = request.body;
      const scopes = await context.scopes(request, [body.scope]);

      const exists = await checkCacheEntry({
        lease: context.lease(request),
        writeScope: scopes.writeScope(body.scope),
        key: body.key,
        version: body.version,
      });
      return {exists};
    },
  });
}
