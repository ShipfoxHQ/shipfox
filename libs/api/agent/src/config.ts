import {createConfig, num, str} from '@shipfox/config';

export const config = createConfig({
  AGENT_CREDENTIALS_ENCRYPTION_KEY: str({
    desc: 'Base64-encoded 32-byte key used to encrypt saved agent provider credentials. Required. Generate one with openssl rand -base64 32.',
  }),
  AGENT_PROVIDER_VALIDATION_TIMEOUT_MS: num({
    desc: 'Maximum time in milliseconds to wait for the live provider test request when saving credentials.',
    default: 10000,
  }),
});
