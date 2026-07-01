import {z} from 'zod';

export const SUPPORTED_AGENT_PROVIDER_IDS = [
  'anthropic',
  'ant-ling',
  'azure-openai-responses',
  'openai',
  'deepseek',
  'nvidia',
  'google',
  'mistral',
  'groq',
  'cerebras',
  'cloudflare-ai-gateway',
  'cloudflare-workers-ai',
  'xai',
  'openrouter',
  'vercel-ai-gateway',
  'zai',
  'zai-coding-cn',
  'opencode',
  'opencode-go',
  'huggingface',
  'fireworks',
  'together',
  'kimi-coding',
  'minimax',
  'minimax-cn',
  'moonshotai',
  'moonshotai-cn',
  'xiaomi',
  'xiaomi-token-plan-cn',
  'xiaomi-token-plan-ams',
  'xiaomi-token-plan-sgp',
] as const;

export const UNSUPPORTED_AGENT_PROVIDER_IDS = [
  'amazon-bedrock',
  'google-vertex',
  'openai-codex',
  'github-copilot',
] as const;

export const AGENT_PROVIDER_IDS = [
  ...SUPPORTED_AGENT_PROVIDER_IDS,
  ...UNSUPPORTED_AGENT_PROVIDER_IDS,
] as const;

export const supportedAgentProviderIdSchema = z.enum(SUPPORTED_AGENT_PROVIDER_IDS);
export const agentProviderIdSchema = z.enum(AGENT_PROVIDER_IDS);
export const AGENT_PROVIDER_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
export const agentProviderRefSchema = z.string().regex(AGENT_PROVIDER_SLUG_PATTERN);

export type SupportedAgentProviderId = z.infer<typeof supportedAgentProviderIdSchema>;
export type AgentProviderId = z.infer<typeof agentProviderIdSchema>;
export type AgentProviderRef = z.infer<typeof agentProviderRefSchema>;

export function isReservedAgentProviderId(value: string): boolean {
  return (AGENT_PROVIDER_IDS as readonly string[]).includes(value);
}
