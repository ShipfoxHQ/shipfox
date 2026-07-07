import {agentThinkingSchema, DEFAULT_HARNESS, harnessSchema} from '@shipfox/workflow-document';
import {z} from 'zod';
import {modelProviderRefSchema} from './model-provider-id.js';

const agentToolSensitivitySchema = z.enum(['read', 'write']);
const agentToolJsonSchema = z.record(z.string(), z.unknown());
const agentToolRequiredScopeSchema = z.array(z.unknown());

export const materializedAgentIntegrationToolMethodSchema = z.strictObject({
  id: z.string().min(1),
  token: z.string().min(1),
  sensitivity: agentToolSensitivitySchema,
  sensitive: z.boolean(),
  requiredScope: agentToolRequiredScopeSchema,
});

export const materializedAgentIntegrationToolSchema = z.strictObject({
  id: z.string().min(1),
  sensitivity: agentToolSensitivitySchema,
  sensitive: z.boolean(),
  requiredScope: agentToolRequiredScopeSchema,
  inputSchema: agentToolJsonSchema,
  outputSchema: agentToolJsonSchema.optional(),
  methods: z.array(materializedAgentIntegrationToolMethodSchema).min(1).optional(),
});

export const materializedAgentIntegrationSchema = z.strictObject({
  connectionId: z.string().min(1),
  connectionSlug: z.string().min(1),
  provider: z.string().min(1),
  repos: z.array(z.string().min(1)).min(1),
  requiredScope: agentToolRequiredScopeSchema,
  tools: z.array(materializedAgentIntegrationToolSchema).min(1),
});

export const materializedAgentStepConfigSchema = z
  .object({
    harness: harnessSchema.default(DEFAULT_HARNESS),
    provider: modelProviderRefSchema,
    model: z.string().min(1),
    thinking: agentThinkingSchema,
    tools: z.array(z.string().min(1)).min(1).optional(),
    integrations: z.array(materializedAgentIntegrationSchema).min(1).optional(),
    prompt: z.string(),
  })
  .strip();

export type MaterializedAgentStepConfigDto = z.infer<typeof materializedAgentStepConfigSchema>;
export type MaterializedAgentIntegrationConfigDto = z.infer<
  typeof materializedAgentIntegrationSchema
>;
export type MaterializedAgentIntegrationToolConfigDto = z.infer<
  typeof materializedAgentIntegrationToolSchema
>;
