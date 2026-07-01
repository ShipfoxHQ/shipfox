import {z} from 'zod';
import {secretKeySchema} from './identifiers.js';
import {secretWriteWarningSchema} from './warnings.js';

const timestampSchema = z.string().datetime();
const projectIdSchema = z.string().uuid().nullable();
const optionalProjectIdSchema = z.string().uuid().optional();
const listLimitSchema = z.coerce.number().int().min(1).max(100).default(50);
const cursorSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_-]+$/);

export const secretDtoSchema = z.object({
  key: secretKeySchema,
  project_id: projectIdSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
  last_edited_by: z.string().uuid().nullable(),
});
export type SecretDto = z.infer<typeof secretDtoSchema>;

export const variableDtoSchema = secretDtoSchema.extend({
  value: z.string(),
});
export type VariableDto = z.infer<typeof variableDtoSchema>;

export const listSecretsQuerySchema = z.object({
  project_id: optionalProjectIdSchema,
  limit: listLimitSchema,
  cursor: cursorSchema.optional(),
});
export type ListSecretsQueryDto = z.infer<typeof listSecretsQuerySchema>;

export const listVariablesQuerySchema = listSecretsQuerySchema;
export type ListVariablesQueryDto = z.infer<typeof listVariablesQuerySchema>;

export const secretScopeQuerySchema = z.object({
  project_id: optionalProjectIdSchema,
});
export type SecretScopeQueryDto = z.infer<typeof secretScopeQuerySchema>;

export const listSecretsResponseSchema = z.object({
  secrets: z.array(secretDtoSchema),
  next_cursor: cursorSchema.nullable(),
});
export type ListSecretsResponseDto = z.infer<typeof listSecretsResponseSchema>;

export const listVariablesResponseSchema = z.object({
  variables: z.array(variableDtoSchema),
  next_cursor: cursorSchema.nullable(),
});
export type ListVariablesResponseDto = z.infer<typeof listVariablesResponseSchema>;

export const getVariableResponseSchema = z.object({
  variable: variableDtoSchema,
});
export type GetVariableResponseDto = z.infer<typeof getVariableResponseSchema>;

export const putSecretBodySchema = z.object({
  project_id: optionalProjectIdSchema,
  value: z.string(),
});
export type PutSecretBodyDto = z.infer<typeof putSecretBodySchema>;

export const putVariableBodySchema = putSecretBodySchema;
export type PutVariableBodyDto = z.infer<typeof putVariableBodySchema>;

export const batchSecretEntryBodySchema = z.object({
  key: secretKeySchema,
  value: z.string(),
});
export type BatchSecretEntryBodyDto = z.infer<typeof batchSecretEntryBodySchema>;

const batchEntriesSchema = z
  .array(batchSecretEntryBodySchema)
  .min(1)
  .superRefine((entries, ctx) => {
    const seen = new Set<string>();
    entries.forEach((entry, index) => {
      if (!seen.has(entry.key)) {
        seen.add(entry.key);
        return;
      }

      ctx.addIssue({
        code: 'custom',
        path: [index, 'key'],
        message: 'Duplicate batch keys are not allowed.',
      });
    });
  });

export const batchSecretsBodySchema = z.object({
  project_id: optionalProjectIdSchema,
  entries: batchEntriesSchema,
});
export type BatchSecretsBodyDto = z.infer<typeof batchSecretsBodySchema>;

export const batchVariablesBodySchema = batchSecretsBodySchema;
export type BatchVariablesBodyDto = z.infer<typeof batchVariablesBodySchema>;

export const putSecretResponseSchema = z.object({
  secret: secretDtoSchema,
  warnings: z.array(secretWriteWarningSchema),
});
export type PutSecretResponseDto = z.infer<typeof putSecretResponseSchema>;

export const putVariableResponseSchema = z.object({
  variable: variableDtoSchema,
  warnings: z.array(secretWriteWarningSchema),
});
export type PutVariableResponseDto = z.infer<typeof putVariableResponseSchema>;

export const batchSecretsResponseSchema = z.object({
  secrets: z.array(secretDtoSchema),
  warnings: z.array(secretWriteWarningSchema),
});
export type BatchSecretsResponseDto = z.infer<typeof batchSecretsResponseSchema>;

export const batchVariablesResponseSchema = z.object({
  variables: z.array(variableDtoSchema),
  warnings: z.array(secretWriteWarningSchema),
});
export type BatchVariablesResponseDto = z.infer<typeof batchVariablesResponseSchema>;
