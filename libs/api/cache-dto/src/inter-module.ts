import {defineInterModuleContract, type InterModuleClient} from '@shipfox/inter-module';
import {z} from 'zod';
import {
  CACHE_ENTRIES_DEFAULT_PAGE_LIMIT,
  CACHE_ENTRIES_MAX_PAGE_LIMIT,
  CACHE_RECENT_DELETIONS_LIMIT,
  cacheDeletionReasonSchema,
  cacheStoredScopeSchema,
} from './schemas/management.js';
import {cacheKeySchema, cacheScopeSchema} from './schemas/runner-routes.js';

const idSchema = z.string().uuid();
const dateTimeSchema = z.string().datetime();
const bytesSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const projectNotFound = z.object({projectId: idSchema});

/**
 * Producer-owned cache management for callers that act for a workspace, such as agent access.
 * Every operation names the workspace the caller is bound to, and the producer refuses a project
 * that does not belong to it.
 */
export const cacheInterModuleContract = defineInterModuleContract({
  module: 'cache',
  methods: {
    listCacheEntries: {
      input: z.object({
        workspaceId: idSchema,
        projectId: idSchema,
        scope: cacheStoredScopeSchema.optional(),
        keyPrefix: cacheKeySchema.optional(),
        cursor: z.string().min(1).optional(),
        limit: z
          .number()
          .int()
          .min(1)
          .max(CACHE_ENTRIES_MAX_PAGE_LIMIT)
          .default(CACHE_ENTRIES_DEFAULT_PAGE_LIMIT),
      }),
      output: z.object({
        entries: z.array(
          z.object({
            id: idSchema,
            scope: cacheStoredScopeSchema,
            devSandbox: z
              .object({userId: z.string().min(1).nullable(), scope: cacheScopeSchema})
              .nullable(),
            key: cacheKeySchema,
            sizeBytes: bytesSchema,
            createdAt: dateTimeSchema,
            lastUsedAt: dateTimeSchema,
            createdByRunId: idSchema,
            cursor: z.string().min(1).describe('Continues the listing right after this entry.'),
          }),
        ),
        nextCursor: z.string().nullable(),
      }),
      errors: {'project-not-found': projectNotFound, 'invalid-cursor': z.object({})},
    },
    getCacheUsage: {
      input: z.object({workspaceId: idSchema}),
      output: z.object({
        storedBytes: bytesSchema,
        limitBytes: bytesSchema.nullable(),
        projects: z.array(
          z.object({projectId: idSchema, storedBytes: bytesSchema, entryCount: z.number().int()}),
        ),
        recentDeletions: z
          .array(
            z.object({
              projectId: idSchema,
              scope: cacheStoredScopeSchema,
              key: cacheKeySchema,
              sizeBytes: bytesSchema,
              reason: cacheDeletionReasonSchema,
              deletedAt: dateTimeSchema,
            }),
          )
          .max(CACHE_RECENT_DELETIONS_LIMIT),
      }),
    },
    /** Deletes one entry, or every committed entry of one stored scope. */
    deleteCacheEntries: {
      input: z.object({
        workspaceId: idSchema,
        projectId: idSchema,
        target: z.union([
          z.strictObject({entryId: idSchema}),
          z.strictObject({scope: cacheStoredScopeSchema}),
        ]),
      }),
      output: z.object({deletedCount: z.number().int().min(0), deletedBytes: bytesSchema}),
      errors: {
        'project-not-found': projectNotFound,
        'entry-not-found': z.object({entryId: idSchema}),
      },
    },
  },
});

export type CacheModuleClient = InterModuleClient<typeof cacheInterModuleContract>;
