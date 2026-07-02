import {agentThinkingSchema} from '@shipfox/workflow-document';
import {z} from 'zod';
import {customModelProviderRuntimeConfigSchema} from './custom-model-provider.js';
import {isReservedModelProviderId, modelProviderRefSchema} from './model-provider-id.js';

const credentialKeySchema = z.string().min(1);
const credentialValueSchema = z.string().min(1);

/**
 * Lease-scoped runtime credentials. The credential values are secrets and must
 * never be written to logs, traces, client state, or generic catalog surfaces.
 */
export const agentRuntimeCredentialsResponseSchema = z
  .object({
    model_provider_id: modelProviderRefSchema,
    model: z.string().min(1),
    thinking: agentThinkingSchema,
    credentials: z.record(credentialKeySchema, credentialValueSchema),
    custom_model_provider: customModelProviderRuntimeConfigSchema.optional(),
  })
  .superRefine((response, ctx) => {
    if (
      isReservedModelProviderId(response.model_provider_id) ||
      response.custom_model_provider !== undefined
    ) {
      return;
    }

    ctx.addIssue({
      code: 'custom',
      path: ['custom_model_provider'],
      message: 'Custom model provider runtime config is required for custom model provider refs.',
    });
  });

export type AgentRuntimeCredentialsResponseDto = z.infer<
  typeof agentRuntimeCredentialsResponseSchema
>;
export type {CustomModelProviderRuntimeConfigDto} from './custom-model-provider.js';
export {customModelProviderRuntimeConfigSchema};
