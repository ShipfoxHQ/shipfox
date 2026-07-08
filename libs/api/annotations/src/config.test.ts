import {vi} from '@shipfox/vitest/vi';

describe.each([
  'ANNOTATIONS_MAX_BODY_BYTES',
  'ANNOTATIONS_MAX_PER_EXECUTION',
  'ANNOTATIONS_MAX_TOTAL_BYTES',
] as const)('%s validation', (name) => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each(['0', '-5', '1.5'])('fails startup when the value is %s', async (value) => {
    vi.stubEnv(name, value);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow(name);
  });

  it('accepts a whole number greater than 0', async () => {
    vi.stubEnv(name, '1');
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config[name]).toBe(1);
  });
});

describe('annotation config defaults', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uses the documented annotation budget defaults', async () => {
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.ANNOTATIONS_MAX_BODY_BYTES).toBe(1048576);
    expect(config.ANNOTATIONS_MAX_PER_EXECUTION).toBe(50);
    expect(config.ANNOTATIONS_MAX_TOTAL_BYTES).toBe(4194304);
  });
});
