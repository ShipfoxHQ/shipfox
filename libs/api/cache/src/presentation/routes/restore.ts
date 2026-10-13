import {cacheRestoreBodySchema, cacheRestoreResponseSchema} from '@shipfox/api-cache-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {restoreCache} from '#core/restore-cache.js';
import {type CacheRequestContext, translateCacheError} from './request-context.js';

export function createRestoreRoute(context: CacheRequestContext) {
  return defineRoute({
    method: 'POST',
    path: '/restore',
    description:
      'Find the entry to restore: the exact key, then the restore keys by newest first, per scope in order. Returns a signed download URL.',
    schema: {
      body: cacheRestoreBodySchema,
      response: {200: cacheRestoreResponseSchema},
    },
    errorHandler: translateCacheError,
    handler: async (request) => {
      const body = request.body;
      const scopes = await context.scopes(request, [body.scope, ...body.fallback_scopes]);

      const found = await restoreCache({
        lease: context.lease(request),
        scopes,
        scope: body.scope,
        fallbackScopes: body.fallback_scopes,
        key: body.key,
        restoreKeys: body.restore_keys,
        version: body.version,
      });
      if (!found) return {hit: null};

      return {
        hit: {
          entry_id: found.entry.id,
          scope: found.scope,
          key: found.entry.key,
          exact: found.exact,
          size_bytes: found.entry.sizeBytes,
          sha256: found.entry.sha256,
          url: found.url,
        },
      };
    },
  });
}
