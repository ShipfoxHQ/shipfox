process.env.POSTGRES_HOST ??= 'localhost';
process.env.POSTGRES_PORT ??= '5432';
process.env.POSTGRES_USERNAME ??= 'shipfox';
process.env.POSTGRES_PASSWORD ??= 'password';
process.env.POSTGRES_DATABASE = 'api_test';
process.env.POSTGRES_MAX_CONNECTIONS = '1';
process.env.TZ = 'UTC';
process.env.DISCORD_APPLICATION_ID = 'test-discord-application-id';
process.env.DISCORD_OAUTH_CLIENT_SECRET = 'test-discord-client-secret';
process.env.DISCORD_OAUTH_REDIRECT_URL =
  'https://shipfox.example.com/integrations/discord/callback';
process.env.DISCORD_PUBLIC_KEY = 'test-discord-public-key';
process.env.DISCORD_BOT_TOKEN = 'test-discord-bot-token';
process.env.DISCORD_GATEWAY_ENABLED = 'false';
process.env.DISCORD_API_BASE_URL = 'https://discord.config.test/api/v10';
