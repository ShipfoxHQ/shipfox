import {z} from 'zod';
import {getModelProviderEntry} from './catalog.js';
import {modelProviderRefSchema, type SupportedModelProviderId} from './model-provider-id.js';

const credentialKeySchema = z.string().min(1);
const credentialRecordSchema = z.record(credentialKeySchema, z.string().min(1));

export const modelProviderConfigDtoSchema = z.object({
  model_provider_id: modelProviderRefSchema,
  default_model: z.string().min(1).nullable(),
  key_fingerprints: z.record(credentialKeySchema, z.string()),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type ModelProviderConfigDto = z.infer<typeof modelProviderConfigDtoSchema>;

export const listModelProviderConfigsResponseSchema = z.object({
  configs: z.array(modelProviderConfigDtoSchema),
  default_model_provider_id: modelProviderRefSchema.nullable(),
});

export type ListModelProviderConfigsResponseDto = z.infer<
  typeof listModelProviderConfigsResponseSchema
>;

export const updateModelProviderConfigBodySchema = z.object({
  default_model: z.string().min(1).nullable().optional(),
  credentials: credentialRecordSchema.refine((credentials) => Object.keys(credentials).length > 0, {
    message: 'Credentials must include at least one key.',
  }),
  set_as_default: z.boolean().optional(),
});

export type UpdateModelProviderConfigBodyDto = z.infer<typeof updateModelProviderConfigBodySchema>;

export const updateModelProviderDefaultModelBodySchema = z.object({
  default_model: z.string().min(1).nullable(),
});

export type UpdateModelProviderDefaultModelBodyDto = z.infer<
  typeof updateModelProviderDefaultModelBodySchema
>;

export const setDefaultModelProviderBodySchema = z.object({
  model_provider_id: modelProviderRefSchema,
});

export type SetDefaultModelProviderBodyDto = z.infer<typeof setDefaultModelProviderBodySchema>;

export const setDefaultModelProviderResponseSchema = z.object({
  default_model_provider_id: modelProviderRefSchema.nullable(),
});

export type SetDefaultModelProviderResponseDto = z.infer<
  typeof setDefaultModelProviderResponseSchema
>;

export function getModelProviderCredentialKeys(
  modelProviderId: SupportedModelProviderId,
): string[] | undefined {
  const entry = getModelProviderEntry(modelProviderId);
  if (entry === undefined || entry.support_status !== 'supported') return undefined;
  return entry.credential_fields.map((field) => field.key).sort();
}

export function modelProviderCredentialKeysMatch(
  modelProviderId: SupportedModelProviderId,
  credentials: Record<string, string>,
): boolean {
  const expectedKeys = getModelProviderCredentialKeys(modelProviderId);
  if (expectedKeys === undefined) return false;
  return sameKeys(Object.keys(credentials).sort(), expectedKeys);
}

function sameKeys(actualKeys: string[], expectedKeys: string[]): boolean {
  if (actualKeys.length !== expectedKeys.length) return false;
  return actualKeys.every((key, index) => key === expectedKeys[index]);
}
