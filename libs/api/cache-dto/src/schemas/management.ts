import {z} from 'zod';
import {CACHE_SCOPE_PATTERN, cacheKeySchema, cacheScopeSchema} from './runner-routes.js';

export const CACHE_ENTRIES_DEFAULT_PAGE_LIMIT = 50;
export const CACHE_ENTRIES_MAX_PAGE_LIMIT = 100;
export const CACHE_RECENT_DELETIONS_LIMIT = 100;
/** A dev sandbox is stored as `dev/{userId}/{scope}`, which is longer than any authored scope. */
export const CACHE_STORED_SCOPE_MAX_LENGTH = 256;

const idSchema = z.string().uuid();
export const cacheStoredScopeSchema = z
  .string()
  .min(1)
  .max(CACHE_STORED_SCOPE_MAX_LENGTH)
  .regex(CACHE_SCOPE_PATTERN);
const dateTimeSchema = z.string().datetime();
const bytesSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const cacheDeletionReasonSchema = z.enum(['expired', 'evicted', 'manual', 'missing']);
export type CacheDeletionReasonDto = z.infer<typeof cacheDeletionReasonSchema>;

export const cacheDevSandboxSchema = z
  .object({
    user_id: z
      .string()
      .min(1)
      .nullable()
      .describe('The member whose dev runs saved here. Null for dev runs with no recorded member.'),
    scope: cacheScopeSchema.describe('The scope as the author wrote it.'),
  })
  .describe('Present when the scope is the private copy of a dev run.');

/**
 * `scope` is the stored scope: the value the entry filter and the scope deletion accept. For a dev
 * sandbox it reads `dev/{userId}/{scope}`, and `dev_sandbox` carries the parts.
 */
const scopeFields = {
  scope: cacheStoredScopeSchema.describe(
    'The stored scope. Pass it back to filter or delete by scope.',
  ),
  dev_sandbox: cacheDevSandboxSchema.nullable(),
};

export const cacheProjectParamsSchema = z.object({projectId: idSchema});
export const cacheWorkspaceParamsSchema = z.object({workspaceId: idSchema});
export const cacheProjectEntryParamsSchema = cacheProjectParamsSchema.extend({entryId: idSchema});
/** The scope is the rest of the path, so a long scope or an unescaped `/` still reaches the route. */
export const cacheProjectScopeParamsSchema = cacheProjectParamsSchema.extend({
  '*': cacheStoredScopeSchema,
});

export const cacheScopeSummarySchema = z.object({
  ...scopeFields,
  entry_count: z.number().int().min(1),
  size_bytes: bytesSchema,
  last_used_at: dateTimeSchema,
});
export type CacheScopeSummaryDto = z.infer<typeof cacheScopeSummarySchema>;

export const listCacheScopesResponseSchema = z.object({
  scopes: z.array(cacheScopeSummarySchema),
});
export type ListCacheScopesResponseDto = z.infer<typeof listCacheScopesResponseSchema>;

export const listCacheEntriesQuerySchema = z.object({
  scope: cacheStoredScopeSchema.optional(),
  key_prefix: cacheKeySchema.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(CACHE_ENTRIES_MAX_PAGE_LIMIT)
    .default(CACHE_ENTRIES_DEFAULT_PAGE_LIMIT),
});
export type ListCacheEntriesQueryDto = z.infer<typeof listCacheEntriesQuerySchema>;

export const cacheEntrySummarySchema = z.object({
  id: idSchema,
  ...scopeFields,
  key: cacheKeySchema,
  size_bytes: bytesSchema,
  created_at: dateTimeSchema,
  last_used_at: dateTimeSchema,
  created_by_run_id: idSchema,
});
export type CacheEntrySummaryDto = z.infer<typeof cacheEntrySummarySchema>;

export const listCacheEntriesResponseSchema = z.object({
  entries: z.array(cacheEntrySummarySchema),
  next_cursor: z.string().nullable(),
});
export type ListCacheEntriesResponseDto = z.infer<typeof listCacheEntriesResponseSchema>;

export const deleteCacheScopeResponseSchema = z.object({
  deleted_count: z.number().int().min(0),
  deleted_bytes: bytesSchema,
});
export type DeleteCacheScopeResponseDto = z.infer<typeof deleteCacheScopeResponseSchema>;

export const cacheUsageResponseSchema = z.object({
  stored_bytes: bytesSchema.describe('Bytes of committed entries, compressed, as of now.'),
  limit_bytes: bytesSchema
    .nullable()
    .describe('Storage limit of the workspace. Null when the workspace has none.'),
  projects: z.array(
    z.object({
      project_id: idSchema,
      stored_bytes: bytesSchema,
      entry_count: z.number().int().min(1),
    }),
  ),
  recent_deletions: z
    .array(
      z.object({
        project_id: idSchema,
        scope: cacheStoredScopeSchema,
        key: cacheKeySchema,
        size_bytes: bytesSchema,
        reason: cacheDeletionReasonSchema,
        deleted_at: dateTimeSchema,
      }),
    )
    .max(CACHE_RECENT_DELETIONS_LIMIT)
    .describe('The newest deletions of the last 30 days.'),
});
export type CacheUsageResponseDto = z.infer<typeof cacheUsageResponseSchema>;

export const cacheSettingsResponseSchema = z.object({
  retention_days: z.number().int().min(1),
  default_retention_days: z.number().int().min(1),
  max_retention_days: z.number().int().min(1),
});
export type CacheSettingsResponseDto = z.infer<typeof cacheSettingsResponseSchema>;

export const updateCacheSettingsBodySchema = z.object({
  retention_days: z.number().int().min(1),
});
export type UpdateCacheSettingsBodyDto = z.infer<typeof updateCacheSettingsBodySchema>;
