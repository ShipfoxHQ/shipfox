import {defineInterModuleContract, type InterModuleClient} from '@shipfox/inter-module';
import {z} from 'zod';
import {
  agentRuntimeCredentialsResponseSchema,
  agentThinkingSchema,
  harnessSchema,
  modelProviderRefSchema,
} from '#schemas/index.js';

const agentConfigInputSchema = z.object({
  harness: harnessSchema.optional(),
  provider: modelProviderRefSchema.optional(),
  model: z.string().optional(),
  thinking: agentThinkingSchema.optional(),
});

const resolvedAgentConfigSchema = z.object({
  harness: harnessSchema,
  provider: modelProviderRefSchema,
  model: z.string(),
  thinking: agentThinkingSchema,
});

export const agentInterModuleContract = defineInterModuleContract({
  module: 'agent',
  methods: {
    resolveAgentConfig: {
      input: z.object({workspaceId: z.string().uuid().nullable(), config: agentConfigInputSchema}),
      output: resolvedAgentConfigSchema,
      errors: {'agent-config-invalid': z.object({})},
    },
    resolveRuntimeCredentials: {
      input: z.object({
        workspaceId: z.string().uuid(),
        harness: harnessSchema,
        provider: modelProviderRefSchema,
        model: z.string(),
        thinking: agentThinkingSchema,
      }),
      output: agentRuntimeCredentialsResponseSchema,
      errors: {
        'model-provider-not-configured': z.object({}),
        'model-provider-credentials-invalid': z.object({}),
      },
    },
  },
});

export type AgentInterModuleClient = InterModuleClient<typeof agentInterModuleContract>;
