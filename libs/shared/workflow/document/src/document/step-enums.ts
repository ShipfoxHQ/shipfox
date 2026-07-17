import {z} from 'zod';

export const harnessSchema = z.enum(['pi', 'claude']).meta({
  description: 'Agent harness. Use `pi` by default, or `claude` for Claude Code.',
});
export type Harness = z.infer<typeof harnessSchema>;
export const DEFAULT_HARNESS = 'pi' as const satisfies Harness;

export const piAgentThinkingSchema = z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);
export const claudeAgentThinkingSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
export const agentThinkingSchema = z
  .enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  .meta({
    description:
      'Reasoning effort for an agent step. Supported values depend on `harness`; defaults to `xhigh`.',
  });

export type AgentThinking = z.infer<typeof agentThinkingSchema>;

export const DEFAULT_AGENT_THINKING = 'xhigh' as const satisfies AgentThinking;

export const agentThinkingByHarness = {
  pi: piAgentThinkingSchema,
  claude: claudeAgentThinkingSchema,
} as const satisfies Record<
  Harness,
  typeof piAgentThinkingSchema | typeof claudeAgentThinkingSchema
>;

export function thinkingLevelsForHarness(harness: Harness): readonly AgentThinking[] {
  return agentThinkingByHarness[harness].options;
}

// Used by later resolution layers when no workspace or instance provider is configured.
export const DEFAULT_MODEL_PROVIDER = 'anthropic' as const;
