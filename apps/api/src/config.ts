import {createConfig, str, url} from '@shipfox/config';

export const config = createConfig({
  E2E_MANAGED_PROVIDER_BASE_URL: url({
    desc: 'Gateway root for the E2E-only managed model provider fixture. Leave unset outside the E2E harness.',
    default: undefined,
  }),
  E2E_OPENROUTER_API_KEY: str({
    desc: 'OpenRouter API key for the E2E managed provider fixture. When set together with E2E_ENABLED and E2E_MANAGED_PROVIDER_BASE_URL, an E2E route can send a project to OpenRouter for real model calls. Leave unset outside live eval runs.',
    default: undefined,
  }),
});
