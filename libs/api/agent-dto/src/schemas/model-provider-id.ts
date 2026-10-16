import {z} from 'zod';

export const SUPPORTED_MODEL_PROVIDER_IDS = [
  'anthropic',
  'ant-ling',
  'azure-openai-responses',
  'baseten',
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
  'qwen-token-plan',
  'qwen-token-plan-cn',
  'qwen-token-plan-individual',
  'minimax',
  'minimax-cn',
  'moonshotai',
  'moonshotai-cn',
  'xiaomi',
  'xiaomi-token-plan-cn',
  'xiaomi-token-plan-ams',
  'xiaomi-token-plan-sgp',
] as const;

export const UNSUPPORTED_MODEL_PROVIDER_IDS = [
  'amazon-bedrock',
  'google-vertex',
  'openai-codex',
  'github-copilot',
  'meta',
  'radius',
  'typesafe',
] as const;

export const MODEL_PROVIDER_IDS = [
  ...SUPPORTED_MODEL_PROVIDER_IDS,
  ...UNSUPPORTED_MODEL_PROVIDER_IDS,
] as const;

export const supportedModelProviderIdSchema = z.enum(SUPPORTED_MODEL_PROVIDER_IDS);
export const providerIdSchema = z.enum(MODEL_PROVIDER_IDS);
export const MODEL_PROVIDER_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
export const modelProviderRefSchema = z.string().regex(MODEL_PROVIDER_SLUG_PATTERN);

export type SupportedModelProviderId = z.infer<typeof supportedModelProviderIdSchema>;
export type ModelProviderId = z.infer<typeof providerIdSchema>;
export type ModelProviderRef = z.infer<typeof modelProviderRefSchema>;

/** Pi 1.x provider IDs that differ from the Shipfox ID stored in provider configs and secrets. */
const PI_MODEL_PROVIDER_IDS: Readonly<Record<string, string>> = {
  'azure-openai-responses': 'azure',
};

/** Shipfox and Pi built-in provider IDs, which custom and managed providers cannot use. */
export function isReservedModelProviderId(value: string): boolean {
  return (
    (MODEL_PROVIDER_IDS as readonly string[]).includes(value) ||
    Object.values(PI_MODEL_PROVIDER_IDS).includes(value)
  );
}

/** Translates a Shipfox provider ID into the ID Pi knows it by. */
export function piModelProviderId(providerId: string): string {
  return PI_MODEL_PROVIDER_IDS[providerId] ?? providerId;
}
