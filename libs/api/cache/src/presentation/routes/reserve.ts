import {cacheReserveBodySchema, cacheReserveResponseSchema} from '@shipfox/api-cache-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {reserveCacheEntry} from '#core/reserve-cache-entry.js';
import {type CacheRequestContext, translateCacheError} from './request-context.js';

export function createReserveRoute(context: CacheRequestContext) {
  return defineRoute({
    method: 'POST',
    path: '/entries',
    description:
      'Reserve a key for a new entry and get one signed upload URL per part. A reserve for the same key by the same job execution returns the reservation again.',
    schema: {
      body: cacheReserveBodySchema,
      response: {200: cacheReserveResponseSchema},
    },
    errorHandler: translateCacheError,
    handler: async (request) => {
      const body = request.body;
      const scopes = await context.scopes(request, [body.scope]);

      const result = await reserveCacheEntry({
        lease: context.lease(request),
        writeScope: scopes.writeScope(body.scope),
        key: body.key,
        version: body.version,
        sizeBytes: body.size_bytes,
        sha256: body.sha256,
        limits: context.limits,
      });
      if (result.status !== 'reserved') return {status: result.status};

      return {
        status: 'reserved' as const,
        entry_id: result.entryId,
        part_size: result.partSize,
        part_urls: result.partUrls,
      };
    },
  });
}
