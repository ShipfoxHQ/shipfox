import {createConfig, str, url} from '@shipfox/config';

export const config = createConfig({
  SLACK_OAUTH_CLIENT_ID: str({
    desc: 'OAuth client ID of the Slack app, used to start and complete the Slack connect flow. Required.',
  }),
  SLACK_OAUTH_CLIENT_SECRET: str({
    desc: 'OAuth client secret of the Slack app, used to exchange authorization codes for workspace bot tokens. Required.',
  }),
  SLACK_SIGNING_SECRET: str({
    desc: 'Secret used to verify incoming Slack events and commands. It must match the signing secret configured on the Slack app. Required.',
  }),
  SLACK_OAUTH_REDIRECT_URL: url({
    desc: 'Public client callback URL Slack redirects to after OAuth authorization, such as https://shipfox.example.com/integrations/slack/callback. Required.',
  }),
  SLACK_API_BASE_URL: url({
    desc: 'Slack Web API base URL. Override this only when routing Slack API requests through a proxy or test server.',
    default: 'https://slack.com/api',
  }),
});
