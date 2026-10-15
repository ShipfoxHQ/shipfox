import {describe, expect, test} from '@shipfox/vitest/vi';
import {registerRunnerBodySchema} from './register.js';

const body = {
  labels: ['linux'],
  capabilities: {harnesses: {}},
  lifecycle_capabilities: ['local_execution_fence_v1'],
};

describe('registerRunnerBodySchema', () => {
  test('rejects a registration without a platform', () => {
    const result = registerRunnerBodySchema.safeParse(body);

    expect(result.success).toBe(false);
  });

  test('accepts a reported platform', () => {
    const result = registerRunnerBodySchema.safeParse({
      ...body,
      platform: {os: 'windows', arch: 'x64'},
    });

    expect(result.data?.platform).toEqual({os: 'windows', arch: 'x64'});
  });

  test.each([
    {os: 'win32', arch: 'x64'},
    {os: 'linux', arch: 'X64'},
    {os: 'linux', arch: ''},
    {os: 'linux', arch: 'a'.repeat(17)},
  ])('rejects platform $os/$arch', (platform) => {
    const result = registerRunnerBodySchema.safeParse({...body, platform});

    expect(result.success).toBe(false);
  });
});
