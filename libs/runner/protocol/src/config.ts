import {createConfig, str} from '@shipfox/config';

export const config = createConfig({
  SHIPFOX_API_URL: str({
    desc: 'Base URL of the Shipfox API the runner connects to, such as https://api.shipfox.io. Required.',
  }),
  SHIPFOX_RUNNER_TOKEN: str({
    desc: 'Bearer token the runner uses to authenticate with the API. Set a real value in production.',
    default: 'static-poc-token',
  }),
});
