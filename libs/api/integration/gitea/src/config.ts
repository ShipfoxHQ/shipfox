import {createConfig, num, str, url} from '@shipfox/config';

export const config = createConfig({
  GITEA_BASE_URL: url({
    desc: 'Base URL of the Gitea instance the provider connects to, including the scheme (for example https://gitea.example.com). Required.',
  }),
  GITEA_SERVICE_USERNAME: str({
    desc: 'Username of the Gitea service account the provider authenticates as. Required.',
  }),
  GITEA_SERVICE_TOKEN: str({
    desc: 'Access token or bot password of the Gitea service account, used for REST API and git-http basic auth. Required.',
  }),
  GITEA_WEBHOOK_SECRET: str({
    desc: 'Secret used to verify the signature of incoming Gitea webhooks. Must match the secret set on the Gitea org webhook. Required.',
  }),
  GITEA_WEBHOOK_TARGET_URL: url({
    desc: 'Public URL that Gitea delivers webhooks to. Points at this API and must be reachable from the Gitea instance. Required.',
  }),
  GITEA_CHECKOUT_TTL_SECONDS: num({
    desc: 'Lifetime in seconds of the checkout credentials handed to the runner. Defaults to 300 (five minutes).',
    default: 300,
  }),
  GITEA_REQUEST_TIMEOUT_MS: num({
    desc: 'How long in milliseconds the provider waits for a Gitea REST API response before giving up. A request that exceeds this fails as a timeout instead of holding an API worker open. Defaults to 10000 (ten seconds).',
    default: 10_000,
  }),
});
