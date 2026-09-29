import {bool, createConfig, str, url} from '@shipfox/config';

export const config = createConfig({
  INTEGRATIONS_ENABLE_DISCORD_PROVIDER: bool({
    desc: 'Enables the Discord integration provider so users can connect Discord servers. It is disabled by default.',
    default: false,
  }),
  DISCORD_APPLICATION_ID: str({
    desc: 'Discord application ID used as the OAuth client ID and bot identity. Required when the Discord provider is enabled.',
  }),
  DISCORD_OAUTH_CLIENT_SECRET: str({
    desc: 'Discord OAuth client secret used for authorization-code exchange and signed state. Required when the Discord provider is enabled.',
  }),
  DISCORD_OAUTH_REDIRECT_URL: url({
    desc: 'Public client callback URL Discord redirects to after authorization. Set it to the URL configured in the Discord application. Required when the Discord provider is enabled.',
  }),
  DISCORD_PUBLIC_KEY: str({
    desc: 'Discord application public key used to verify interaction signatures. Required when the Discord provider is enabled.',
  }),
  DISCORD_BOT_TOKEN: str({
    desc: 'Discord bot token used by the Gateway and REST client. Required when the Discord provider is enabled.',
  }),
  DISCORD_GATEWAY_ENABLED: bool({
    desc: 'Starts the Discord Gateway service. Keep it disabled until Discord message and reaction handlers are deployed.',
    default: false,
  }),
  DISCORD_API_BASE_URL: url({
    desc: 'Discord API base URL. Override it when routing requests through a proxy or an E2E fake.',
    default: 'https://discord.com/api/v10',
  }),
});
