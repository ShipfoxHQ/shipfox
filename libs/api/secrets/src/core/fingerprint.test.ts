import {describe, expect, it} from '@shipfox/vitest/vi';
import {fingerprintSecretValue} from './fingerprint.js';

describe('fingerprintSecretValue', () => {
  it('returns the last four characters only', () => {
    const result = fingerprintSecretValue('abcdefghijklmnopqrstuvwxyz');

    expect(result).toBe('wxyz');
  });

  it('suppresses short values and strips URL credentials', () => {
    expect(fingerprintSecretValue('abcd')).toBeNull();
    expect(fingerprintSecretValue('https://user:password@example.com/path')).toBe('path');
  });
});
