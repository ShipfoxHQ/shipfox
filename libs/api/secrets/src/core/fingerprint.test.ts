import {describe, expect, it} from '@shipfox/vitest/vi';
import {fingerprintSecretValue} from './fingerprint.js';

const HMAC_FINGERPRINT_PATTERN = /^hmac-sha256:[A-Za-z0-9_-]{43}$/;

describe('fingerprintSecretValue', () => {
  it('returns a keyed non-reversible fingerprint', () => {
    const key = Buffer.alloc(32, 1);

    const result = fingerprintSecretValue('abcdefghijklmnopqrstuvwxyz', key);

    expect(result).toMatch(HMAC_FINGERPRINT_PATTERN);
    expect(result).not.toContain('wxyz');
  });

  it('is stable for the same key and value and changes with the key', () => {
    const firstKey = Buffer.alloc(32, 1);
    const secondKey = Buffer.alloc(32, 2);

    const first = fingerprintSecretValue('secret-value', firstKey);
    const same = fingerprintSecretValue('secret-value', firstKey);
    const differentKey = fingerprintSecretValue('secret-value', secondKey);

    expect(same).toBe(first);
    expect(differentKey).not.toBe(first);
  });
});
