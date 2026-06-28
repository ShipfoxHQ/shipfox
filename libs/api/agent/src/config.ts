import {createConfig, num} from '@shipfox/config';

export const config = createConfig({
  AGENT_PROVIDER_VALIDATION_TIMEOUT_MS: num({
    desc: 'Maximum time in milliseconds to wait for the live provider test request when saving credentials.',
    default: 10000,
  }),
});
