import {createConfig, url} from '@shipfox/config';

export const config = createConfig({
  CLIENT_BASE_URL: url({
    desc: 'Base URL of the client app. Branded emails load the Shipfox logo from it. Set it to the full URL of your deployment.',
    default: 'http://localhost:5173',
  }),
});
