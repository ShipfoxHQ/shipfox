import {createConfig, str} from '@shipfox/config';

export const config = createConfig({
  SENTRY_DSN: str({
    desc: 'Sentry DSN that error reports are sent to. Leave it unset to turn Sentry off.',
    default: undefined,
  }),
  SENTRY_ENVIRONMENT: str({
    desc: 'Environment name attached to Sentry events, such as production or staging.',
    default: undefined,
  }),
  SENTRY_IMAGE: str({
    desc: 'Container image name and tag of the running build. The release version is read from the tag and attached to Sentry events.',
    default: undefined,
  }),
});
