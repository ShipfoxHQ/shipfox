import {createConfig, str} from '@shipfox/config';

export const config = createConfig({
  CLIENT_BASE_URL: str({
    desc: 'Base URL of the client app. Branded emails embed the Shipfox logo from this origin (served by the client app at /email-logo.png), so it must be a URL email clients can reach. Set it to your deployment domain.',
    default: 'http://localhost:3000',
  }),
});
