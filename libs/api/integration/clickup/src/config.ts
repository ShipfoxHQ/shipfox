import {createConfig, str, url} from '@shipfox/config';

export const config = createConfig({
  CLICKUP_OAUTH_CLIENT_ID: str({
    desc: 'OAuth client ID of the ClickUp app used to start and complete the ClickUp connect flow. Required.',
  }),
  CLICKUP_OAUTH_CLIENT_SECRET: str({
    desc: 'OAuth client secret of the ClickUp app used for authorization-code exchange. Required.',
  }),
  CLICKUP_OAUTH_REDIRECT_URL: url({
    desc: 'Public client callback URL that ClickUp redirects to after authorization. Set it to the callback URL configured on the ClickUp app. Required.',
  }),
  CLICKUP_WEBHOOK_BASE_URL: url({
    desc: 'Public HTTPS base URL where ClickUp delivers connection webhooks. Required.',
  }),
  CLICKUP_API_BASE_URL: url({
    desc: 'ClickUp API base URL. Override it when routing API requests through a proxy or an E2E fake.',
    default: 'https://api.clickup.com',
  }),
  CLICKUP_AUTH_BASE_URL: url({
    desc: 'ClickUp authorization base URL. Override it when routing OAuth authorization through a proxy or test server.',
    default: 'https://app.clickup.com',
  }),
});
