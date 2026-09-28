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
    desc: 'Public client callback URL Linear redirects to after OAuth authorization, such as https://shipfox.example.com/integrations/linear/callback. Required.',
  }),
  LINEAR_MCP_ENDPOINT: url({
    desc: 'Streamable HTTP endpoint used for Linear MCP tool calls. Set this only when routing Linear tools through a compatible proxy or test server.',
    default: 'https://mcp.linear.app/mcp',
  }),
  LINEAR_GRAPHQL_ENDPOINT: url({
    desc: 'Linear GraphQL API endpoint used for identity checks and native Linear tools. Set this only when routing Linear API calls through a compatible proxy or test server.',
    default: 'https://api.linear.app/graphql',
  }),
};

export const config = createConfig(linearConfigSchema);
