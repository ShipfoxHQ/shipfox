import {agentThinkingSchema} from '@shipfox/workflow-document';
import {z} from 'zod';
import {supportedAgentProviderIdSchema} from './provider-id.js';

export const materializedAgentStepConfigSchema = z
  .object({
    provider: supportedAgentProviderIdSchema,
    model: z.string().min(1),
    thinking: agentThinkingSchema,
    prompt: z.string(),
  })
  .strip();

export type MaterializedAgentStepConfigDto = z.infer<typeof materializedAgentStepConfigSchema>;
