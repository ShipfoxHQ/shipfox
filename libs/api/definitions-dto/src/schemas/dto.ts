import {z} from 'zod';

export const createDefinitionBodySchema = z
  .object({
    project_id: z.string().uuid(),
    config_path: z.string().min(1).optional(),
    source: z.enum(['manual', 'vcs']).optional(),
    yaml: z.string().min(1).max(1_000_000),
    sha: z.string().optional(),
    ref: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.source === 'vcs' && !value.config_path) {
      ctx.addIssue({
        code: 'custom',
        message: 'config_path is required for VCS definitions',
        path: ['config_path'],
      });
    }
  });

export type CreateDefinitionBodyDto = z.infer<typeof createDefinitionBodySchema>;

export const definitionDtoSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  config_path: z.string().nullable(),
  source: z.enum(['manual', 'vcs']),
  sha: z.string().nullable(),
  ref: z.string().nullable(),
  name: z.string(),
  definition: z.record(z.string(), z.unknown()),
  fetched_at: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type DefinitionDto = z.infer<typeof definitionDtoSchema>;

export const definitionResponseSchema = definitionDtoSchema;

export type DefinitionResponseDto = z.infer<typeof definitionResponseSchema>;

export const definitionSyncSummarySchema = z.object({
  ref: z.string().nullable(),
  status: z.enum(['pending', 'syncing', 'succeeded', 'failed']),
  last_sync_at: z.string(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  last_error_code: z
    .enum([
      'no-workflow-files',
      'invalid-definition',
      'provider-repository-not-found',
      'provider-file-not-found',
      'provider-access-denied',
      'provider-rate-limited',
      'provider-timeout',
      'provider-unavailable',
      'provider-malformed-response',
      'content-too-large',
      'too-many-files',
      'connection-unavailable',
      'unknown',
    ])
    .nullable(),
  last_error_message: z.string().nullable(),
});

export type DefinitionSyncSummaryDto = z.infer<typeof definitionSyncSummarySchema>;

export const definitionListResponseSchema = z.object({
  definitions: z.array(definitionResponseSchema),
  sync: definitionSyncSummarySchema.nullable(),
});

export type DefinitionListResponseDto = z.infer<typeof definitionListResponseSchema>;
