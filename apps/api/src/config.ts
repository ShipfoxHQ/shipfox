import {bool, createConfig, str} from '@shipfox/config';

export const config = createConfig({
  E2E_ENABLED: bool({
    desc: 'Enables the end-to-end test routes under /__e2e. Keep it false in production.',
    default: false,
  }),
  E2E_ADMIN_API_KEY: str({
    desc: 'Bearer token that protects the E2E admin routes. Set it when E2E_ENABLED is true.',
    default: undefined,
  }),
});
