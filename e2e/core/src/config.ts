import {createConfig, str} from '@shipfox/config';

export const config = createConfig({
  API_URL: str({
    desc: 'Base URL of the API that the end-to-end tests run against.',
    default: 'http://localhost:16101',
  }),
  CLIENT_URL: str({
    desc: 'Base URL of the client app that the end-to-end tests run against.',
    default: 'http://localhost:5173',
  }),
  E2E_ADMIN_API_KEY: str({
    desc: "Bearer token the end-to-end tests use to call the API's E2E admin routes. Must match the API's E2E_ADMIN_API_KEY.",
    default: 'e2e-admin-api-key',
  }),
});
