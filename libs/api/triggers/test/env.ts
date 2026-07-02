process.env.POSTGRES_HOST ??= 'localhost';
process.env.POSTGRES_PORT ??= '5432';
process.env.POSTGRES_USERNAME ??= 'shipfox';
process.env.POSTGRES_PASSWORD ??= 'password';
process.env.POSTGRES_DATABASE = 'api_test';
process.env.POSTGRES_MAX_CONNECTIONS ??= '5';
process.env.MODEL_PROVIDER_CREDENTIALS_ENCRYPTION_KEY =
  'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
process.env.SECRETS_ENCRYPTION_KEK = 'ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA=';
process.env.TZ = 'UTC';
