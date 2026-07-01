import {z} from 'zod';
import {getAgentProviderEntry} from './catalog.js';
import {agentProviderRefSchema, type SupportedAgentProviderId} from './provider-id.js';

const credentialKeySchema = z.string().min(1);
const credentialRecordSchema = z.record(credentialKeySchema, z.string().min(1));

export const agentProviderConfigDtoSchema = z.object({
  provider_id: agentProviderRefSchema,
  default_model: z.string().min(1).nullable(),
  key_fingerprints: z.record(credentialKeySchema, z.string()),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type AgentProviderConfigDto = z.infer<typeof agentProviderConfigDtoSchema>;

export const listAgentProviderConfigsResponseSchema = z.object({
  configs: z.array(agentProviderConfigDtoSchema),
  default_provider_id: agentProviderRefSchema.nullable(),
});

export type ListAgentProviderConfigsResponseDto = z.infer<
  typeof listAgentProviderConfigsResponseSchema
>;

export const updateAgentProviderConfigBodySchema = z.object({
  default_model: z.string().min(1).nullable().optional(),
  credentials: credentialRecordSchema.refine((credentials) => Object.keys(credentials).length > 0, {
    message: 'Credentials must include at least one key.',
  }),
  set_as_default: z.boolean().optional(),
});

export type UpdateAgentProviderConfigBodyDto = z.infer<typeof updateAgentProviderConfigBodySchema>;

export const updateAgentProviderDefaultModelBodySchema = z.object({
  default_model: z.string().min(1).nullable(),
});

export type UpdateAgentProviderDefaultModelBodyDto = z.infer<
  typeof updateAgentProviderDefaultModelBodySchema
>;

export const setDefaultAgentProviderBodySchema = z.object({
  provider_id: agentProviderRefSchema,
});

export type SetDefaultAgentProviderBodyDto = z.infer<typeof setDefaultAgentProviderBodySchema>;

export const setDefaultAgentProviderResponseSchema = z.object({
  default_provider_id: agentProviderRefSchema.nullable(),
});

export type SetDefaultAgentProviderResponseDto = z.infer<
  typeof setDefaultAgentProviderResponseSchema
>;

export function getAgentProviderCredentialKeys(
  providerId: SupportedAgentProviderId,
): string[] | undefined {
  const entry = getAgentProviderEntry(providerId);
  if (entry === undefined || entry.support_status !== 'supported') return undefined;
  return entry.credential_fields.map((field) => field.key).sort();
}

export function agentProviderCredentialKeysMatch(
  providerId: SupportedAgentProviderId,
  credentials: Record<string, string>,
): boolean {
  const expectedKeys = getAgentProviderCredentialKeys(providerId);
  if (expectedKeys === undefined) return false;
  return sameKeys(Object.keys(credentials).sort(), expectedKeys);
}

function sameKeys(actualKeys: string[], expectedKeys: string[]): boolean {
  if (actualKeys.length !== expectedKeys.length) return false;
  return actualKeys.every((key, index) => key === expectedKeys[index]);
}
