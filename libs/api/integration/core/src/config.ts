import {bool, createConfig} from '@shipfox/config';

export const config = createConfig({
  INTEGRATIONS_ENABLE_DEBUG_PROVIDER: bool({
    desc: 'Enables the debug integration provider, which is meant for testing. Keep it false in production.',
    default: false,
  }),
  INTEGRATIONS_ENABLE_GITEA_PROVIDER: bool({
    desc: 'Enables the Gitea integration provider so users can connect a Gitea instance.',
    default: false,
  }),
  INTEGRATIONS_ENABLE_GITHUB_PROVIDER: bool({
    desc: 'Enables the GitHub integration provider so users can connect GitHub.',
    default: false,
  }),
  INTEGRATIONS_ENABLE_SENTRY_PROVIDER: bool({
    desc: 'Enables the Sentry integration provider so users can connect Sentry.',
    default: false,
  }),
  INTEGRATIONS_ENABLE_WEBHOOK_PROVIDER: bool({
    desc: 'Enables the generic webhook integration provider so users can create inbound webhook URLs.',
    default: false,
  }),
});
