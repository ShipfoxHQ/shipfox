import {createConfig, url} from '@shipfox/config';

export const config = createConfig({
  WEBHOOK_PUBLIC_URL: url({
    desc: 'Public origin of the API used to build webhook inbound URLs returned to users. Set it to the externally reachable API URL, including the scheme.',
    default: 'http://localhost:3000',
  }),
});
