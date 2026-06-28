import {
  agentThinkingSchema,
  DEFAULT_AGENT_PROVIDER,
  DEFAULT_AGENT_THINKING,
} from '@shipfox/workflow-document';
import {z} from 'zod';
import {
  type AgentProviderId,
  agentProviderIdSchema,
  SUPPORTED_AGENT_PROVIDER_IDS,
  type SupportedAgentProviderId,
  UNSUPPORTED_AGENT_PROVIDER_IDS,
} from './provider-id.js';

export type {AgentThinking} from '@shipfox/workflow-document';
export {agentThinkingSchema, DEFAULT_AGENT_PROVIDER, DEFAULT_AGENT_THINKING};

export const agentModelOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});

export type AgentModelOptionDto = z.infer<typeof agentModelOptionSchema>;

export const agentProviderCredentialFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  secret: z.boolean(),
});

export type AgentProviderCredentialFieldDto = z.infer<typeof agentProviderCredentialFieldSchema>;

export const agentProviderSupportStatusSchema = z.enum(['supported', 'unsupported']);

export type AgentProviderSupportStatus = z.infer<typeof agentProviderSupportStatusSchema>;

const supportedAgentProviderIds = new Set<string>(SUPPORTED_AGENT_PROVIDER_IDS);
const unsupportedAgentProviderIds = new Set<string>(UNSUPPORTED_AGENT_PROVIDER_IDS);

const agentProviderCatalogSeedBaseSchema = z.object({
  id: agentProviderIdSchema,
  label: z.string().min(1),
  support_status: agentProviderSupportStatusSchema,
  default_model: z.string().min(1).nullable(),
  credential_fields: z.array(agentProviderCredentialFieldSchema),
  unsupported_reason: z.string().min(1).nullable(),
});

export const agentProviderCatalogSeedSchema =
  agentProviderCatalogSeedBaseSchema.superRefine(validateCatalogSeedEntry);

export type AgentProviderCatalogSeedDto = z.infer<typeof agentProviderCatalogSeedSchema>;

export const agentProviderCatalogEntrySchema = agentProviderCatalogSeedBaseSchema
  .extend({
    models: z.array(agentModelOptionSchema),
  })
  .superRefine((entry, ctx) => {
    validateCatalogSeedEntry(entry, ctx);

    if (entry.support_status === 'supported') {
      if (entry.models.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['models'],
          message: 'Supported agent providers must include at least one model.',
        });
      }
      if (
        entry.default_model !== null &&
        !entry.models.some((model) => model.id === entry.default_model)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['default_model'],
          message: 'Supported agent provider default_model must be present in models.',
        });
      }
    } else if (entry.models.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['models'],
        message: 'Unsupported agent providers must not include models.',
      });
    }
  });

export type AgentProviderCatalogEntryDto = z.infer<typeof agentProviderCatalogEntrySchema>;

const apiKeyCredentialFields = [credentialField('api_key', 'API key', true)];

const azureCredentialFields = [
  credentialField('endpoint', 'Endpoint', false),
  credentialField('api_key', 'API key', true),
];

const cloudflareAiGatewayCredentialFields = [
  credentialField('api_key', 'API token', true),
  credentialField('account_id', 'Account ID', false),
  credentialField('gateway_id', 'Gateway ID', false),
];

const cloudflareWorkersAiCredentialFields = [
  credentialField('api_key', 'API token', true),
  credentialField('account_id', 'Account ID', false),
];

export const AGENT_PROVIDER_CATALOG_SEED: AgentProviderCatalogSeedDto[] = [
  supportedProvider('anthropic', 'Anthropic', 'claude-opus-4-8'),
  supportedProvider('ant-ling', 'Ant Ling', 'Ring-2.6-1T'),
  supportedProvider('azure-openai-responses', 'Azure OpenAI', 'gpt-5.5-pro', azureCredentialFields),
  supportedProvider('openai', 'OpenAI', 'gpt-5.5-pro'),
  supportedProvider('deepseek', 'DeepSeek', 'deepseek-v4-pro'),
  supportedProvider('nvidia', 'NVIDIA', 'nvidia/nemotron-3-ultra-550b-a55b'),
  supportedProvider('google', 'Google AI Studio', 'gemini-3.1-pro-preview'),
  supportedProvider('mistral', 'Mistral', 'mistral-large-latest'),
  supportedProvider('groq', 'Groq', 'openai/gpt-oss-120b'),
  supportedProvider('cerebras', 'Cerebras', 'gpt-oss-120b'),
  supportedProvider(
    'cloudflare-ai-gateway',
    'Cloudflare AI Gateway',
    'claude-opus-4-8',
    cloudflareAiGatewayCredentialFields,
  ),
  supportedProvider(
    'cloudflare-workers-ai',
    'Cloudflare Workers AI',
    '@cf/moonshotai/kimi-k2.7-code',
    cloudflareWorkersAiCredentialFields,
  ),
  supportedProvider('xai', 'xAI', 'grok-4.3'),
  supportedProvider('openrouter', 'OpenRouter', 'anthropic/claude-opus-4.8'),
  supportedProvider('vercel-ai-gateway', 'Vercel AI Gateway', 'anthropic/claude-opus-4.8'),
  supportedProvider('zai', 'Z.ai', 'glm-5.2'),
  supportedProvider('zai-coding-cn', 'Z.ai Coding CN', 'glm-5.2'),
  supportedProvider('opencode', 'OpenCode', 'claude-opus-4-8'),
  supportedProvider('opencode-go', 'OpenCode Go', 'kimi-k2.7-code'),
  supportedProvider('huggingface', 'Hugging Face', 'deepseek-ai/DeepSeek-V4-Pro'),
  supportedProvider('fireworks', 'Fireworks', 'accounts/fireworks/models/deepseek-v4-pro'),
  supportedProvider('together', 'Together AI', 'deepseek-ai/DeepSeek-V4-Pro'),
  supportedProvider('kimi-coding', 'Kimi Coding', 'k2p7'),
  supportedProvider('minimax', 'MiniMax', 'MiniMax-M3'),
  supportedProvider('minimax-cn', 'MiniMax CN', 'MiniMax-M3'),
  supportedProvider('moonshotai', 'Moonshot AI', 'kimi-k2.7-code'),
  supportedProvider('moonshotai-cn', 'Moonshot AI CN', 'kimi-k2.7-code'),
  supportedProvider('xiaomi', 'Xiaomi', 'mimo-v2.5-pro'),
  supportedProvider('xiaomi-token-plan-cn', 'Xiaomi Token Plan CN', 'mimo-v2.5-pro'),
  supportedProvider('xiaomi-token-plan-ams', 'Xiaomi Token Plan AMS', 'mimo-v2.5-pro'),
  supportedProvider('xiaomi-token-plan-sgp', 'Xiaomi Token Plan SGP', 'mimo-v2.5-pro'),
  unsupportedProvider(
    'amazon-bedrock',
    'Amazon Bedrock',
    'AWS cloud credentials are not supported by workspace API-key provider configs yet.',
  ),
  unsupportedProvider(
    'google-vertex',
    'Google Vertex AI',
    'GCP cloud credentials are not supported by workspace API-key provider configs yet.',
  ),
  unsupportedProvider(
    'openai-codex',
    'OpenAI Codex',
    'ChatGPT subscription and OAuth credentials are not supported by workspace API-key provider configs yet.',
  ),
  unsupportedProvider(
    'github-copilot',
    'GitHub Copilot',
    'GitHub Copilot OAuth credentials are not supported by workspace API-key provider configs yet.',
  ),
];

export function getAgentProviderEntry(id: string): AgentProviderCatalogSeedDto | undefined {
  return AGENT_PROVIDER_CATALOG_SEED.find((entry) => entry.id === id);
}

export function listSupportedAgentProviders(): AgentProviderCatalogSeedDto[] {
  return AGENT_PROVIDER_CATALOG_SEED.filter((entry) => entry.support_status === 'supported');
}

function validateCatalogSeedEntry(
  entry: z.infer<typeof agentProviderCatalogSeedBaseSchema>,
  ctx: z.RefinementCtx,
): void {
  if (entry.support_status === 'supported') {
    if (!supportedAgentProviderIds.has(entry.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['id'],
        message: 'Supported catalog entries must use a supported agent provider id.',
      });
    }
    if (entry.default_model === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['default_model'],
        message: 'Supported agent providers must define a default_model.',
      });
    }
    if (entry.credential_fields.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['credential_fields'],
        message: 'Supported agent providers must define credential_fields.',
      });
    }
    if (entry.unsupported_reason !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['unsupported_reason'],
        message: 'Supported agent providers must not define unsupported_reason.',
      });
    }
  } else {
    if (!unsupportedAgentProviderIds.has(entry.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['id'],
        message: 'Unsupported catalog entries must use an unsupported agent provider id.',
      });
    }
    if (entry.default_model !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['default_model'],
        message: 'Unsupported agent providers must not define a default_model.',
      });
    }
    if (entry.credential_fields.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['credential_fields'],
        message: 'Unsupported agent providers must not define credential_fields.',
      });
    }
    if (entry.unsupported_reason === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['unsupported_reason'],
        message: 'Unsupported agent providers must define unsupported_reason.',
      });
    }
  }
}

function credentialField(
  key: string,
  label: string,
  secret: boolean,
): AgentProviderCredentialFieldDto {
  return {key, label, secret};
}

function supportedProvider(
  id: SupportedAgentProviderId,
  label: string,
  defaultModel: string,
  credentialFields: AgentProviderCredentialFieldDto[] = apiKeyCredentialFields,
): AgentProviderCatalogSeedDto {
  return {
    id,
    label,
    support_status: 'supported',
    default_model: defaultModel,
    credential_fields: credentialFields.map((field) => ({...field})),
    unsupported_reason: null,
  };
}

function unsupportedProvider(
  id: AgentProviderId,
  label: string,
  unsupportedReason: string,
): AgentProviderCatalogSeedDto {
  return {
    id,
    label,
    support_status: 'unsupported',
    default_model: null,
    credential_fields: [],
    unsupported_reason: unsupportedReason,
  };
}
