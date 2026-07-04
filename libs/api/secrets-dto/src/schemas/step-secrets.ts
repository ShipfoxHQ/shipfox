import {z} from 'zod';
import {secretKeySchema} from './identifiers.js';
import {secretStoreSchema} from './secret-binding.js';

export const stepSecretsParamsSchema = z.object({
  stepId: z.string().uuid(),
});

export type StepSecretsParamsDto = z.infer<typeof stepSecretsParamsSchema>;

export const stepSecretsQuerySchema = z.object({
  attempt: z.coerce.number().int().positive(),
});

export type StepSecretsQueryDto = z.infer<typeof stepSecretsQuerySchema>;

export const stepSecretDtoSchema = z.object({
  store: secretStoreSchema,
  key: secretKeySchema,
  value: z.string(),
});

export type StepSecretDto = z.infer<typeof stepSecretDtoSchema>;

export const stepSecretsResponseSchema = z.object({
  secrets: z.array(stepSecretDtoSchema),
});

export type StepSecretsResponseDto = z.infer<typeof stepSecretsResponseSchema>;
