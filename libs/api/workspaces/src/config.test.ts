import {vi} from '@shipfox/vitest/vi';

describe('workspaces config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    ['0', 'greater than 0'],
    ['10.5', 'whole number'],
    ['10001', 'cannot exceed'],
  ])('rejects WORKSPACES_MAX_PER_WORKSPACE=%s', async (value, message) => {
    vi.stubEnv('WORKSPACES_MAX_PER_WORKSPACE', value);
    vi.resetModules();

    await expect(import('./config.js')).rejects.toThrow(message);
  });
});
