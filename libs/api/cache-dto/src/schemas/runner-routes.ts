import {z} from 'zod';

export const CACHE_KEY_MAX_LENGTH = 512;
export const CACHE_SCOPE_MAX_LENGTH = 128;
export const CACHE_RESTORE_KEYS_MAX = 10;
export const CACHE_FALLBACK_SCOPES_MAX = 5;
/** Every part but the last has this size. The reserve response signs one URL per part. */
export const CACHE_PART_SIZE_BYTES = 32 * 1024 * 1024;
/** S3 allows at most 10000 parts in one multipart upload. */
export const CACHE_MAX_PARTS = 10_000;

export const CACHE_SCOPE_PATTERN = /^[A-Za-z0-9._/-]+$/;
const VERSION_PATTERN = /^[A-Za-z0-9._-]+$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export const cacheScopeSchema = z
  .string()
  .min(1)
  .max(CACHE_SCOPE_MAX_LENGTH)
  .regex(CACHE_SCOPE_PATTERN)
  .describe(
    'Author-chosen namespace inside the project, made of letters, digits, and . _ - /. The dev/ prefix is reserved.',
  );

export const cacheKeySchema = z
  .string()
  .min(1)
  .max(CACHE_KEY_MAX_LENGTH)
  .refine((key) => !key.includes('\u0000'), 'A key cannot contain a NUL character.');

export const cacheVersionSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(VERSION_PATTERN)
  .describe(
    'Hash of the saved paths, the runner platform and architecture, and the archive format.',
  );

const sizeBytesSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const sha256Schema = z.string().regex(SHA256_PATTERN);

export const cacheRestoreBodySchema = z.object({
  scope: cacheScopeSchema,
  fallback_scopes: z.array(cacheScopeSchema).max(CACHE_FALLBACK_SCOPES_MAX).default([]),
  key: cacheKeySchema,
  restore_keys: z.array(cacheKeySchema).max(CACHE_RESTORE_KEYS_MAX).default([]),
  version: cacheVersionSchema,
});

export type CacheRestoreBodyDto = z.infer<typeof cacheRestoreBodySchema>;

export const cacheRestoreHitSchema = z.object({
  entry_id: z.string().uuid(),
  scope: cacheScopeSchema.describe('The scope the author wrote, not the dev sandbox it came from.'),
  key: cacheKeySchema,
  exact: z.boolean().describe('True when the entry key equals the requested primary key.'),
  size_bytes: sizeBytesSchema,
  sha256: sha256Schema,
  url: z.string().url().describe('Signed GET URL for the archive. It accepts Range headers.'),
});

export const cacheRestoreResponseSchema = z.object({
  hit: cacheRestoreHitSchema.nullable(),
});

export type CacheRestoreResponseDto = z.infer<typeof cacheRestoreResponseSchema>;

export const cacheReserveBodySchema = z.object({
  scope: cacheScopeSchema,
  key: cacheKeySchema,
  version: cacheVersionSchema,
  size_bytes: sizeBytesSchema,
  sha256: sha256Schema,
});

export type CacheReserveBodyDto = z.infer<typeof cacheReserveBodySchema>;

export const cacheReserveResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('reserved'),
    entry_id: z.string().uuid(),
    part_size: z.number().int().min(1),
    part_urls: z
      .array(z.string().url())
      .min(1)
      .max(CACHE_MAX_PARTS)
      .describe('Signed PUT URLs in part order. The last part is the remainder.'),
  }),
  z.object({status: z.literal('exists')}),
  z.object({status: z.literal('in_progress')}),
  z.object({status: z.literal('too_large')}),
]);

export type CacheReserveResponseDto = z.infer<typeof cacheReserveResponseSchema>;

export const cacheEntryParamsSchema = z.object({entryId: z.string().uuid()});

export const cacheCommitBodySchema = z.object({
  parts: z
    .array(
      z.object({
        number: z.number().int().min(1).max(CACHE_MAX_PARTS),
        etag: z.string().min(1),
      }),
    )
    .min(1)
    .max(CACHE_MAX_PARTS),
});

export type CacheCommitBodyDto = z.infer<typeof cacheCommitBodySchema>;

export const cacheCommitResponseSchema = z.object({status: z.literal('ready')});

export const cacheCheckBodySchema = z.object({
  scope: cacheScopeSchema,
  key: cacheKeySchema,
  version: cacheVersionSchema,
});

export type CacheCheckBodyDto = z.infer<typeof cacheCheckBodySchema>;

export const cacheCheckResponseSchema = z.object({exists: z.boolean()});
