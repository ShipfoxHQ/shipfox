import {createConfig, url} from '@shipfox/config';

export const config = createConfig({
  E2E_MANAGED_PROVIDER_BASE_URL: url({
    desc: 'Gateway root for the E2E-only managed model provider fixture. Leave unset outside the E2E harness.',
    default: undefined,
  }),
});
