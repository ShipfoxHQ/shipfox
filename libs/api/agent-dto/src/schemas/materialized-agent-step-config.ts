import {agentThinkingSchema} from '@shipfox/workflow-document';
import {z} from 'zod';
import {supportedModelProviderIdSchema} from './model-provider-id.js';

export const materializedAgentStepConfigSchema = z
  .object({
    provider: supportedModelProviderIdSchema,
    model: z.string().min(1),
    thinking: agentThinkingSchema,
    prompt: z.string(),
  })
  .strip();

export type MaterializedAgentStepConfigDto = z.infer<typeof materializedAgentStepConfigSchema>;
