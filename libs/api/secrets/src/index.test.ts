import {describe, expect, it} from '@shipfox/vitest/vi';
import {SecretValueTooLargeError} from './index.js';

describe('package exports', () => {
  it('exports the oversized secret value error from the package root', () => {
    const error = new SecretValueTooLargeError(64 * 1024);

    expect(error).toBeInstanceOf(Error);
    expect(error.maxBytes).toBe(64 * 1024);
  });
});
