import {createConfig, str} from '@shipfox/config';

export const config = createConfig({
  SHIPFOX_API_URL: str({
    desc: 'Base URL of the Shipfox API the runner connects to, such as https://api.shipfox.io. Required.',
  }),
  SHIPFOX_RUNNER_REGISTRATION_TOKEN: str({
    desc: 'Manual or ephemeral registration token the runner exchanges for a short-lived runner session token at startup. Use a value starting with sf_mrt_ or sf_ert_. Required, with no default, so startup fails when it is missing rather than sending a predictable token.',
  }),
  SHIPFOX_RUNNER_LABELS: str({
    desc: 'Comma-separated labels this runner registers with, such as linux,x64,self-hosted. Required, with no default, so startup fails when labels are missing.',
  }),
});
