import {vi} from '@shipfox/vitest/vi';

describe('EPHEMERAL_REGISTRATION_TOKEN_TTL_SECONDS validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    '0',
    '-5',
    '1.5',
    '3601',
  ])('fails startup when EPHEMERAL_REGISTRATION_TOKEN_TTL_SECONDS is %s', async (value) => {
    vi.stubEnv('EPHEMERAL_REGISTRATION_TOKEN_TTL_SECONDS', value);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('EPHEMERAL_REGISTRATION_TOKEN_TTL_SECONDS');
  });

  it('accepts a whole-second value inside the hard ceiling', async () => {
    vi.stubEnv('EPHEMERAL_REGISTRATION_TOKEN_TTL_SECONDS', '3600');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.EPHEMERAL_REGISTRATION_TOKEN_TTL_SECONDS).toBe(3600);
  });
});

describe('REGISTRATION_TOKEN_BATCH_MAX validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    '0',
    '-5',
    '1.5',
    '1001',
  ])('fails startup when REGISTRATION_TOKEN_BATCH_MAX is %s', async (value) => {
    vi.stubEnv('REGISTRATION_TOKEN_BATCH_MAX', value);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('REGISTRATION_TOKEN_BATCH_MAX');
  });

  it('accepts a whole-number value inside the DTO hard ceiling', async () => {
    vi.stubEnv('REGISTRATION_TOKEN_BATCH_MAX', '1000');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.REGISTRATION_TOKEN_BATCH_MAX).toBe(1000);
  });
});
