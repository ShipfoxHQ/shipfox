import {z} from 'zod';
import type {AgentAccessObjectSchema} from './envelope.js';
import {AGENT_ACCESS_DEFAULT_PAGE_LIMIT, AGENT_ACCESS_PAGE_LIMIT_MAX} from './paged-tools.js';
import {dateTimeSchema, idSchema} from './primitives.js';

const CACHE_SCOPE_MAX_LENGTH = 128;
/** A dev sandbox is stored as `dev/{userId}/{scope}`, which is longer than any authored scope. */
const CACHE_STORED_SCOPE_MAX_LENGTH = 256;
const CACHE_KEY_MAX_LENGTH = 512;
const SCOPE_PATTERN = '^[A-Za-z0-9._/-]+$';

const authoredScopeSchema = z
  .string()
  .min(1)
  .max(CACHE_SCOPE_MAX_LENGTH)
  .regex(new RegExp(SCOPE_PATTERN));
const scopeSchema = z
  .string()
  .min(1)
  .max(CACHE_STORED_SCOPE_MAX_LENGTH)
  .regex(new RegExp(SCOPE_PATTERN));
const keyPrefixSchema = z
  .string()
  .min(1)
  .max(CACHE_KEY_MAX_LENGTH)
  .refine((prefix) => !prefix.includes('\u0000'), 'A key prefix cannot contain a NUL character.');
const bytesSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const authoredScopeJson = {
  type: 'string',
  minLength: 1,
  maxLength: CACHE_SCOPE_MAX_LENGTH,
  pattern: SCOPE_PATTERN,
} as const;
const scopeJson = {
  type: 'string',
  minLength: 1,
  maxLength: CACHE_STORED_SCOPE_MAX_LENGTH,
  pattern: SCOPE_PATTERN,
} as const;
const bytesJson = {type: 'integer', minimum: 0} as const;
const uuidJson = {type: 'string', format: 'uuid'} as const;
const dateTimeJson = {type: 'string', format: 'date-time'} as const;

export const listCacheEntriesInputSchema = z
  .object({
    project_id: idSchema,
    scope: scopeSchema.optional(),
    key_prefix: keyPrefixSchema.optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(AGENT_ACCESS_PAGE_LIMIT_MAX)
      .default(AGENT_ACCESS_DEFAULT_PAGE_LIMIT),
    cursor: z.string().min(1).optional(),
  })
  .strict();
export type ListCacheEntriesInputDto = z.output<typeof listCacheEntriesInputSchema>;

export const listCacheEntriesResultSchema = z
  .object({
    entries: z
      .array(
        z
          .object({
            id: idSchema,
            scope: scopeSchema,
            dev_sandbox: z
              .object({user_id: z.string().min(1).nullable(), scope: authoredScopeSchema})
              .strict()
              .nullable(),
            key: z.string().min(1).max(CACHE_KEY_MAX_LENGTH),
            size_bytes: bytesSchema,
            created_at: dateTimeSchema,
            last_used_at: dateTimeSchema,
            created_by_run_id: idSchema,
          })
          .strict(),
      )
      .max(AGENT_ACCESS_PAGE_LIMIT_MAX),
    next_cursor: z.string().min(1).nullable(),
  })
  .strict();
export type ListCacheEntriesResultDto = z.infer<typeof listCacheEntriesResultSchema>;

export const getCacheUsageInputSchema = z.object({}).strict();
export type GetCacheUsageInputDto = z.infer<typeof getCacheUsageInputSchema>;

export const getCacheUsageResultSchema = z
  .object({
    stored_bytes: bytesSchema,
    limit_bytes: bytesSchema.nullable(),
    projects: z.array(
      z
        .object({
          project_id: idSchema,
          stored_bytes: bytesSchema,
          entry_count: z.number().int().min(0),
        })
        .strict(),
    ),
  })
  .strict();
export type GetCacheUsageResultDto = z.infer<typeof getCacheUsageResultSchema>;

export const deleteCacheEntriesInputSchema = z
  .object({
    project_id: idSchema,
    entry_id: idSchema.optional(),
    scope: scopeSchema.optional(),
  })
  .strict()
  .refine((input) => (input.entry_id === undefined) !== (input.scope === undefined), {
    message: 'Pass exactly one of entry_id and scope',
  });
export type DeleteCacheEntriesInputDto = z.output<typeof deleteCacheEntriesInputSchema>;

export const deleteCacheEntriesResultSchema = z
  .object({deleted_count: z.number().int().min(0), deleted_bytes: bytesSchema})
  .strict();
export type DeleteCacheEntriesResultDto = z.infer<typeof deleteCacheEntriesResultSchema>;

export const listCacheEntriesInputJsonSchema = {
  type: 'object',
  properties: {
    project_id: uuidJson,
    scope: scopeJson,
    key_prefix: {
      type: 'string',
      minLength: 1,
      maxLength: CACHE_KEY_MAX_LENGTH,
      pattern: '^[^\\u0000]+$',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: AGENT_ACCESS_PAGE_LIMIT_MAX,
      default: AGENT_ACCESS_DEFAULT_PAGE_LIMIT,
    },
    cursor: {type: 'string', minLength: 1},
  },
  required: ['project_id'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const listCacheEntriesResultJsonSchema = {
  type: 'object',
  properties: {
    entries: {
      type: 'array',
      maxItems: AGENT_ACCESS_PAGE_LIMIT_MAX,
      items: {
        type: 'object',
        properties: {
          id: uuidJson,
          scope: scopeJson,
          dev_sandbox: {
            anyOf: [
              {
                type: 'object',
                properties: {
                  user_id: {anyOf: [{type: 'string', minLength: 1}, {type: 'null'}]},
                  scope: authoredScopeJson,
                },
                required: ['user_id', 'scope'],
                additionalProperties: false,
              },
              {type: 'null'},
            ],
          },
          key: {type: 'string', minLength: 1, maxLength: CACHE_KEY_MAX_LENGTH},
          size_bytes: bytesJson,
          created_at: dateTimeJson,
          last_used_at: dateTimeJson,
          created_by_run_id: uuidJson,
        },
        required: [
          'id',
          'scope',
          'dev_sandbox',
          'key',
          'size_bytes',
          'created_at',
          'last_used_at',
          'created_by_run_id',
        ],
        additionalProperties: false,
      },
    },
    next_cursor: {anyOf: [{type: 'string', minLength: 1}, {type: 'null'}]},
  },
  required: ['entries', 'next_cursor'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const getCacheUsageInputJsonSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const getCacheUsageResultJsonSchema = {
  type: 'object',
  properties: {
    stored_bytes: bytesJson,
    limit_bytes: {anyOf: [bytesJson, {type: 'null'}]},
    projects: {
      type: 'array',
      items: {
        type: 'object',
        properties: {project_id: uuidJson, stored_bytes: bytesJson, entry_count: bytesJson},
        required: ['project_id', 'stored_bytes', 'entry_count'],
        additionalProperties: false,
      },
    },
  },
  required: ['stored_bytes', 'limit_bytes', 'projects'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const deleteCacheEntriesInputJsonSchema = {
  type: 'object',
  properties: {
    project_id: uuidJson,
    entry_id: uuidJson,
    scope: scopeJson,
  },
  required: ['project_id'],
  oneOf: [
    {required: ['entry_id'], not: {required: ['scope']}},
    {required: ['scope'], not: {required: ['entry_id']}},
  ],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const deleteCacheEntriesResultJsonSchema = {
  type: 'object',
  properties: {deleted_count: bytesJson, deleted_bytes: bytesJson},
  required: ['deleted_count', 'deleted_bytes'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;
