import {vi} from '@shipfox/vitest/vi';

const VALID_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';

describe('secrets config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each(['not-base64', `${VALID_KEY}\n`])('rejects malformed KEKs: %s', async (value) => {
    vi.stubEnv('SECRETS_ENCRYPTION_KEK', value);
    vi.resetModules();

    await expect(import('./config.js')).rejects.toThrow('SECRETS_ENCRYPTION_KEK');
  });

  it('accepts current and previous KEKs', async () => {
    vi.stubEnv('SECRETS_ENCRYPTION_KEK', VALID_KEY);
    vi.stubEnv('SECRETS_ENCRYPTION_KEK_PREVIOUS', 'MTIzNDU2Nzg5MGFiY2RlZjEyMzQ1Njc4OTBhYmNkZWY=');
    vi.resetModules();

    const {config} = await import('./config.js');

    expect(config.SECRETS_ENCRYPTION_KEK).toBe(VALID_KEY);
    expect(config.SECRETS_ENCRYPTION_KEK_PREVIOUS).toBe(
      'MTIzNDU2Nzg5MGFiY2RlZjEyMzQ1Njc4OTBhYmNkZWY=',
    );
  });

  it.each([
    ['SECRETS_MAX_PER_WORKSPACE', '0'],
    ['SECRETS_SHORT_VALUE_WARN_LENGTH', '0'],
  ])('rejects invalid numeric config %s=%s', async (name, value) => {
    vi.stubEnv('SECRETS_ENCRYPTION_KEK', VALID_KEY);
    vi.stubEnv(name, value);
    vi.resetModules();

    await expect(import('./config.js')).rejects.toThrow(name);
  });
});
