import {agentThinkingSchema, DEFAULT_HARNESS, harnessSchema} from '@shipfox/workflow-document';
import {z} from 'zod';
import {modelProviderRefSchema} from './model-provider-id.js';

export const materializedAgentStepConfigSchema = z
  .object({
    harness: harnessSchema.default(DEFAULT_HARNESS),
    provider: modelProviderRefSchema,
    model: z.string().min(1),
    thinking: agentThinkingSchema,
    prompt: z.string(),
  })
  .strip();

export type MaterializedAgentStepConfigDto = z.infer<typeof materializedAgentStepConfigSchema>;
