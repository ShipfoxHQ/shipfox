process.env.POSTGRES_HOST ??= 'localhost';
process.env.POSTGRES_PORT ??= '5432';
process.env.POSTGRES_USERNAME ??= 'shipfox';
process.env.POSTGRES_PASSWORD ??= 'password';
process.env.POSTGRES_DATABASE = 'api_test';
process.env.POSTGRES_MAX_CONNECTIONS ??= '5';
process.env.TZ = 'UTC';
process.env.CLICKUP_OAUTH_CLIENT_ID = 'test-client-id';
process.env.CLICKUP_OAUTH_CLIENT_SECRET = 'test-client-secret';
process.env.CLICKUP_OAUTH_REDIRECT_URL =
  'https://shipfox.example.com/integrations/clickup/callback';
process.env.CLICKUP_WEBHOOK_BASE_URL = 'https://shipfox.example.com/webhooks';
process.env.SECRETS_ENCRYPTION_KEK = 'ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA=';
