import {agentThinkingSchema, SUPPORTED_AGENT_PROVIDER_IDS} from '@shipfox/api-agent-dto';
import {createConfig, num, str} from '@shipfox/config';

const AGENT_THINKING_CHOICES = agentThinkingSchema.options;

export const config = createConfig({
  AGENT_CREDENTIALS_ENCRYPTION_KEY: str({
    desc: 'Base64-encoded 32-byte key used to encrypt saved agent provider credentials. Required. Generate one with openssl rand -base64 32.',
  }),
  AGENT_DEFAULT_PROVIDER: str({
    desc: 'Instance-wide default agent provider ID used when a workflow and workspace do not choose one. Optional. Use one of the supported provider IDs from the agent provider catalog.',
    choices: SUPPORTED_AGENT_PROVIDER_IDS,
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
  AGENT_PROVIDER_VALIDATION_TIMEOUT_MS: num({
    desc: 'Maximum time in milliseconds to wait for the live provider test request when saving credentials.',
    default: 10000,
  }),
});
