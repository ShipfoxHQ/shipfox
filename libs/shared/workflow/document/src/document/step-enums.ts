import {z} from 'zod';

// Agent reasoning depth, mapped to the pi harness `thinkingLevel`. A small, stable
// pi-defined set, so it is validated at parse time.
export const agentThinkingSchema = z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);

export type AgentThinking = z.infer<typeof agentThinkingSchema>;

export const DEFAULT_AGENT_THINKING = 'high' as const satisfies AgentThinking;

// Used by later resolution layers when no workspace or instance provider is configured.
export const DEFAULT_MODEL_PROVIDER = 'anthropic' as const;
