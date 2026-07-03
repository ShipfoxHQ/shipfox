import {
  agentThinkingSchema,
  getModelProviderEntry,
  SUPPORTED_MODEL_PROVIDER_IDS,
  type SupportedModelProviderId,
} from '@shipfox/api-agent-dto';
import {bool, createConfig, num, str} from '@shipfox/config';

const AGENT_THINKING_CHOICES = agentThinkingSchema.options;

export const config = createConfig({
  AGENT_DEFAULT_PROVIDER: str({
    desc: 'Instance-wide default model provider ID used when a workflow and workspace do not choose one. Optional. Use one of the supported model provider IDs from the model provider catalog.',
    choices: SUPPORTED_MODEL_PROVIDER_IDS,
    default: undefined,
  }),
  AGENT_DEFAULT_PROVIDER_MODEL: str({
    desc: 'Instance-wide default model ID used when the resolved provider matches AGENT_DEFAULT_PROVIDER and no workflow or workspace model is set. Optional. Use a model ID supported by that provider.',
    default: undefined,
  }),
  AGENT_DEFAULT_PROVIDER_THINKING: str({
    desc: 'Instance-wide default thinking effort used when the resolved provider matches AGENT_DEFAULT_PROVIDER and no workflow or workspace thinking effort is set. Optional. Accepted values are off, minimal, low, medium, high, and xhigh.',
    choices: AGENT_THINKING_CHOICES,
    default: undefined,
  }),
  AGENT_DEFAULT_PROVIDER_API_KEY: str({
    desc: 'API key for the instance default provider. Optional. Must belong to AGENT_DEFAULT_PROVIDER. If you change the default provider, change this key too. Instance defaults support API-key-only providers.',
    default: undefined,
  }),
  AGENT_PROVIDER_VALIDATION_TIMEOUT_MS: num({
    desc: 'Maximum time in milliseconds to wait for the live provider test request when saving credentials.',
    default: 10000,
  }),
  AGENT_CUSTOM_PROVIDER_ALLOW_PRIVATE_NETWORKS: bool({
    desc: 'Allows custom model providers to use private, loopback, link-local, metadata, and .internal network targets. Keep this true for local development and self-hosted private networks. Set it to false on cloud instances.',
    default: true,
  }),
  AGENT_CUSTOM_PROVIDER_HOST_DENYLIST: str({
    desc: 'Comma-separated hosts and IP ranges that custom model providers may not call. Accepts exact hosts, suffix patterns such as .internal.example or *.internal.example, IP literals, and CIDR blocks such as 10.0.0.0/8.',
    default: '',
  }),
});

assertInstanceDefaultModelProviderApiKeyConfig();

function assertInstanceDefaultModelProviderApiKeyConfig(): void {
  if (!config.AGENT_DEFAULT_PROVIDER_API_KEY) return;
  if (!config.AGENT_DEFAULT_PROVIDER) {
    throw new Error('AGENT_DEFAULT_PROVIDER_API_KEY requires AGENT_DEFAULT_PROVIDER to be set.');
  }

  const credentialFields =
    getModelProviderEntry(config.AGENT_DEFAULT_PROVIDER as SupportedModelProviderId)
      ?.credential_fields ?? [];
  const field = credentialFields[0];
  if (credentialFields.length === 1 && field?.key === 'api_key' && field.secret) return;

  throw new Error(
    'AGENT_DEFAULT_PROVIDER_API_KEY requires AGENT_DEFAULT_PROVIDER to use exactly one secret api_key credential field.',
  );
}
