import {z} from 'zod';
import {secretKeySchema} from './identifiers.js';
import {secretDtoSchema, variableDtoSchema} from './management.js';

const optionalProjectIdSchema = z.string().uuid().optional();

export const e2eCreateSecretBodySchema = z.object({
  workspace_id: z.string().uuid(),
  actor_id: z.string().uuid(),
  project_id: optionalProjectIdSchema,
  key: secretKeySchema,
  value: z.string(),
});
export type E2eCreateSecretBodyDto = z.infer<typeof e2eCreateSecretBodySchema>;

export const e2eCreateSecretResponseSchema = secretDtoSchema;
export type E2eCreateSecretResponseDto = z.infer<typeof e2eCreateSecretResponseSchema>;

export const e2eCreateVariableBodySchema = e2eCreateSecretBodySchema;
export type E2eCreateVariableBodyDto = z.infer<typeof e2eCreateVariableBodySchema>;

export const e2eCreateVariableResponseSchema = variableDtoSchema;
export type E2eCreateVariableResponseDto = z.infer<typeof e2eCreateVariableResponseSchema>;
