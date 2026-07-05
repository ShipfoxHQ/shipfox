import {agentThinkingSchema, harnessSchema} from '@shipfox/workflow-document';
import {z} from 'zod';
import {modelProviderRefSchema} from './model-provider-id.js';

export const materializedAgentStepConfigSchema = z
  .object({
    harness: harnessSchema,
    provider: modelProviderRefSchema,
    model: z.string().min(1),
    thinking: agentThinkingSchema,
    prompt: z.string(),
  })
  .strip();

export type MaterializedAgentStepConfigDto = z.infer<typeof materializedAgentStepConfigSchema>;
