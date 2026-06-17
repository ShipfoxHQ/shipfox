import {z} from 'zod';

// Agent reasoning depth, mapped to the pi harness `thinkingLevel`. A small, stable
// pi-defined set, so it is validated at parse time (unlike `model`, which is
// free-text to allow new models and custom providers without a schema change).
export const agentThinkingSchema = z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);

export type AgentThinking = z.infer<typeof agentThinkingSchema>;

export const DEFAULT_AGENT_THINKING = 'high' as const satisfies AgentThinking;
