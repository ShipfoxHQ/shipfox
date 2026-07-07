import {createConfig, str, url} from '@shipfox/config';

const linearConfigSchema = {
  LINEAR_OAUTH_CLIENT_ID: str({
    desc: 'OAuth client ID of the Linear app, used to start and complete the Linear connect flow. Required.',
  }),
  LINEAR_OAUTH_CLIENT_SECRET: str({
    desc: 'OAuth client secret of the Linear app, used to exchange authorization codes for workspace tokens. Required.',
  }),
  LINEAR_WEBHOOK_SIGNING_SECRET: str({
    desc: 'Secret used to verify incoming Linear webhooks. Must match the signing secret configured on the Linear app. Required.',
  }),
  LINEAR_OAUTH_REDIRECT_URL: url({
    desc: 'Absolute callback URL Linear redirects to after OAuth authorization, such as https://shipfox.example.com/integrations/linear/callback/api. Required.',
  }),
};

export const config = createConfig(linearConfigSchema);
