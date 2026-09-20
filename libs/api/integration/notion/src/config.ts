import {createConfig, str, url} from '@shipfox/config';

export const config = createConfig({
  NOTION_OAUTH_CLIENT_ID: str({
    desc: 'OAuth client ID of the Notion public integration used to start and complete the Notion connect flow. Required.',
  }),
  NOTION_OAUTH_CLIENT_SECRET: str({
    desc: 'OAuth client secret of the Notion public integration used for authorization-code exchange. Required.',
  }),
  NOTION_OAUTH_REDIRECT_URL: url({
    desc: 'Public client callback URL Notion redirects to after authorization. Set it to the callback URL configured on the Notion integration. Required.',
  }),
  NOTION_WEBHOOK_VERIFICATION_TOKEN: str({
    desc: 'Token Notion sends during webhook verification and uses to sign webhook bodies. Leave it unset while completing the initial verification handshake.',
    default: undefined,
  }),
  NOTION_API_BASE_URL: url({
    desc: 'Notion API base URL. Override it when routing API requests through a proxy or an E2E fake.',
    default: 'https://api.notion.com',
  }),
});
