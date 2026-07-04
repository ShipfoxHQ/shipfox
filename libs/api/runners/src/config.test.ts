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

describe('RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    '0',
    '-5',
    '1.5',
  ])('fails startup when RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS is %s', async (value) => {
    vi.stubEnv('RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS', value);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow(
      'RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS',
    );
  });

  it('accepts a positive whole-second threshold', async () => {
    vi.stubEnv('RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS', '600');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS).toBe(600);
  });
});

describe('RUNNER_STALE_PROVISIONED_RUNNER_REAPER_LIMIT validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    '0',
    '-5',
    '1.5',
  ])('fails startup when RUNNER_STALE_PROVISIONED_RUNNER_REAPER_LIMIT is %s', async (value) => {
    vi.stubEnv('RUNNER_STALE_PROVISIONED_RUNNER_REAPER_LIMIT', value);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow(
      'RUNNER_STALE_PROVISIONED_RUNNER_REAPER_LIMIT',
    );
  });

  it('accepts a positive whole-number limit', async () => {
    vi.stubEnv('RUNNER_STALE_PROVISIONED_RUNNER_REAPER_LIMIT', '250');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.RUNNER_STALE_PROVISIONED_RUNNER_REAPER_LIMIT).toBe(250);
  });
});

describe('RUNNER_SESSION_LIVENESS_THROTTLE_SECONDS validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    '0',
    '-5',
    '1.5',
  ])('fails startup when RUNNER_SESSION_LIVENESS_THROTTLE_SECONDS is %s', async (value) => {
    vi.stubEnv('RUNNER_SESSION_LIVENESS_THROTTLE_SECONDS', value);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('RUNNER_SESSION_LIVENESS_THROTTLE_SECONDS');
  });

  it('accepts a positive whole-second throttle', async () => {
    vi.stubEnv('RUNNER_SESSION_LIVENESS_THROTTLE_SECONDS', '30');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.RUNNER_SESSION_LIVENESS_THROTTLE_SECONDS).toBe(30);
  });
});

describe('stale provisioned runner threshold validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    ['300', '300'],
    ['299', '300'],
  ])('fails startup when RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS=%s and PROVISIONER_LAST_SEEN_THROTTLE_SECONDS=%s', async (thresholdSeconds, throttleSeconds) => {
    vi.stubEnv('RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS', thresholdSeconds);
    vi.stubEnv('PROVISIONER_LAST_SEEN_THROTTLE_SECONDS', throttleSeconds);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow(
      'RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS',
    );
  });

  it.each([
    ['300', '300'],
    ['299', '300'],
  ])('fails startup when RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS=%s and RUNNER_SESSION_LIVENESS_THROTTLE_SECONDS=%s', async (thresholdSeconds, throttleSeconds) => {
    vi.stubEnv('RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS', thresholdSeconds);
    vi.stubEnv('RUNNER_SESSION_LIVENESS_THROTTLE_SECONDS', throttleSeconds);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow(
      'RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS',
    );
  });
});

describe('PROVISIONED_RUNNER_COUNT_DIVERGENCE_TEMPLATE_KEY_LABEL_ENABLED', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('defaults to disabling template_key on the divergence metric', async () => {
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.PROVISIONED_RUNNER_COUNT_DIVERGENCE_TEMPLATE_KEY_LABEL_ENABLED).toBe(false);
  });

  it('can enable template_key on the divergence metric', async () => {
    vi.stubEnv('PROVISIONED_RUNNER_COUNT_DIVERGENCE_TEMPLATE_KEY_LABEL_ENABLED', 'true');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.PROVISIONED_RUNNER_COUNT_DIVERGENCE_TEMPLATE_KEY_LABEL_ENABLED).toBe(true);
  });
});
