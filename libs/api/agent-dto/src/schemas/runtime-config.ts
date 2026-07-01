import {agentThinkingSchema} from '@shipfox/workflow-document';
import {z} from 'zod';
import {customAgentProviderRuntimeConfigSchema} from './custom-provider.js';
import {agentProviderRefSchema, isReservedAgentProviderId} from './provider-id.js';

const credentialKeySchema = z.string().min(1);
const credentialValueSchema = z.string().min(1);

/**
 * Lease-scoped runtime credentials. The credential values are secrets and must
 * never be written to logs, traces, client state, or generic catalog surfaces.
 */
export const agentRuntimeCredentialsResponseSchema = z
  .object({
    provider_id: agentProviderRefSchema,
    model: z.string().min(1),
    thinking: agentThinkingSchema,
    credentials: z.record(credentialKeySchema, credentialValueSchema),
    custom_provider: customAgentProviderRuntimeConfigSchema.optional(),
  })
  .superRefine((response, ctx) => {
    if (isReservedAgentProviderId(response.provider_id) || response.custom_provider !== undefined) {
      return;
    }

    ctx.addIssue({
      code: 'custom',
      path: ['custom_provider'],
      message: 'Custom provider runtime config is required for custom provider refs.',
    });
  });

export type AgentRuntimeCredentialsResponseDto = z.infer<
  typeof agentRuntimeCredentialsResponseSchema
>;
export type {CustomAgentProviderRuntimeConfigDto} from './custom-provider.js';
export {customAgentProviderRuntimeConfigSchema};
