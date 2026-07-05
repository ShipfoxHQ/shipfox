import {z} from 'zod';

export const harnessSchema = z.enum(['pi', 'claude']);
export type Harness = z.infer<typeof harnessSchema>;
export const DEFAULT_HARNESS = 'pi' as const satisfies Harness;

export const agentThinkingSchema = z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);

export type AgentThinking = z.infer<typeof agentThinkingSchema>;

export const DEFAULT_AGENT_THINKING = 'xhigh' as const satisfies AgentThinking;

// Used by later resolution layers when no workspace or instance provider is configured.
export const DEFAULT_MODEL_PROVIDER = 'anthropic' as const;
