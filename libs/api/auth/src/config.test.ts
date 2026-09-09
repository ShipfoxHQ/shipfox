describe('signup gate configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  test('uses the Auth-prefixed defaults', async () => {
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.AUTH_IMPERSONATION_ENABLED).toBe(false);
    expect(config.AUTH_IMPERSONATION_WINDOW_MAX).toBe('60m');
    expect(config.AUTH_SIGNUP_GATE_ENABLED).toBe(false);
    expect(config.AUTH_SIGNUP_ALLOWED_EMAIL_DOMAINS).toBe('');
    expect(config.AUTH_SIGNUP_ALLOWED_EMAILS).toBe('');
    expect(config.AUTH_SIGNUP_NOT_ALLOWED_MESSAGE).toBeUndefined();
  });

  test('accepts the one-minute and 60-minute window boundaries', async () => {
    vi.stubEnv('AUTH_IMPERSONATION_WINDOW_MAX', '1m');
    vi.resetModules();

    const minimum = await import('#config.js');
    expect(minimum.impersonationWindowMaxSeconds).toBe(60);

    vi.resetModules();
    vi.stubEnv('AUTH_IMPERSONATION_WINDOW_MAX', '60m');
    const maximum = await import('#config.js');
    expect(maximum.impersonationWindowMaxSeconds).toBe(60 * 60);
  });

  test.each([
    '59s',
    '61m',
    '2h',
    'not-a-duration',
  ])('rejects an impersonation window duration outside the one-to-60-minute range: %s', async (value) => {
    vi.stubEnv('AUTH_IMPERSONATION_WINDOW_MAX', value);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('AUTH_IMPERSONATION_WINDOW_MAX');
  });

  test('requires a useful JWT lifetime when impersonation is enabled', async () => {
    vi.stubEnv('AUTH_IMPERSONATION_ENABLED', 'true');
    vi.stubEnv('AUTH_JWT_EXPIRES_IN', '59s');
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow(
      'AUTH_JWT_EXPIRES_IN must be at least 1 minute',
    );
  });

  test('keeps short legacy JWT lifetimes valid while impersonation is disabled', async () => {
    vi.stubEnv('AUTH_IMPERSONATION_ENABLED', 'false');
    vi.stubEnv('AUTH_JWT_EXPIRES_IN', '30s');
    vi.resetModules();

    const {config} = await import('#config.js');
    expect(config.AUTH_JWT_EXPIRES_IN).toBe('30s');
  });

  test('defaults both API URLs to localhost in tests', async () => {
    vi.stubEnv('API_PUBLIC_URL', undefined);
    vi.stubEnv('API_URL', undefined);
    vi.stubEnv('NODE_ENV', 'test');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.API_URL).toBe('http://localhost:3000');
    expect(config.API_PUBLIC_URL).toBe('http://localhost:3000');
  });

  test('requires an explicit API URL in production', async () => {
    vi.stubEnv('API_PUBLIC_URL', 'https://api.example.test');
    vi.stubEnv('API_URL', undefined);
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('process.exit unexpectedly called with "1"');
  });

  test('defaults the public API URL to API_URL', async () => {
    vi.stubEnv('API_PUBLIC_URL', undefined);
    vi.stubEnv('API_URL', 'https://internal-api.example.test');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.API_PUBLIC_URL).toBe('https://internal-api.example.test');
  });

  test('rejects an invalid API_URL fallback', async () => {
    vi.stubEnv('API_PUBLIC_URL', undefined);
    vi.stubEnv('API_URL', 'internal-api.example.test');
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('process.exit unexpectedly called with "1"');
  });

  test('prefers API_PUBLIC_URL to API_URL', async () => {
    vi.stubEnv('API_PUBLIC_URL', 'https://api.example.test');
    vi.stubEnv('API_URL', 'https://internal-api.example.test');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.API_PUBLIC_URL).toBe('https://api.example.test');
  });

  test('rejects a public API URL without a scheme', async () => {
    vi.stubEnv('API_PUBLIC_URL', 'api.example.test');
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('process.exit unexpectedly called with "1"');
  });

  test('fails startup when the enabled gate has no allowlist', async () => {
    vi.stubEnv('AUTH_SIGNUP_GATE_ENABLED', 'true');
    vi.stubEnv('AUTH_SIGNUP_ALLOWED_EMAIL_DOMAINS', ',  ');
    vi.stubEnv('AUTH_SIGNUP_ALLOWED_EMAILS', ' , ');
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow(
      'AUTH_SIGNUP_GATE_ENABLED requires AUTH_SIGNUP_ALLOWED_EMAIL_DOMAINS or AUTH_SIGNUP_ALLOWED_EMAILS',
    );
  });

  test('accepts an enabled gate with either allowlist', async () => {
    vi.stubEnv('AUTH_SIGNUP_GATE_ENABLED', 'true');
    vi.stubEnv('AUTH_SIGNUP_ALLOWED_EMAIL_DOMAINS', 'shipfox.io');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.AUTH_SIGNUP_GATE_ENABLED).toBe(true);
    expect(config.AUTH_SIGNUP_ALLOWED_EMAIL_DOMAINS).toBe('shipfox.io');
  });

  test('rejects a Markdown denial message that exceeds the response limit', async () => {
    vi.stubEnv(
      'AUTH_SIGNUP_NOT_ALLOWED_MESSAGE',
      `${'x'.repeat(499)}[Request access](https://example.test/access)`,
    );
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow(
      'AUTH_SIGNUP_NOT_ALLOWED_MESSAGE must contain at most 500 characters',
    );
  });
});
