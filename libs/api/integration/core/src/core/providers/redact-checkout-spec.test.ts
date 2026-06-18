import type {CheckoutSpec} from '@shipfox/api-integration-core-dto';
import {redactCheckoutSpec} from './redact-checkout-spec.js';

describe('redactCheckoutSpec', () => {
  it('masks the credential token while keeping the other fields intact', () => {
    const expiresAt = new Date('2026-06-10T12:00:00.000Z');
    const spec: CheckoutSpec = {
      repositoryUrl: 'https://github.com/shipfox/platform.git',
      ref: 'main',
      credentials: {username: 'x-access-token', token: 'ghs_supersecret', expiresAt},
    };

    const redacted = redactCheckoutSpec(spec);

    expect(redacted).toEqual({
      repositoryUrl: 'https://github.com/shipfox/platform.git',
      ref: 'main',
      credentials: {username: 'x-access-token', token: '***', expiresAt},
    });
  });

  it('does not mutate the original spec', () => {
    const spec: CheckoutSpec = {
      repositoryUrl: 'https://github.com/shipfox/platform.git',
      ref: 'main',
      credentials: {
        username: 'x-access-token',
        token: 'ghs_supersecret',
        expiresAt: new Date('2026-06-10T12:00:00.000Z'),
      },
    };

    redactCheckoutSpec(spec);

    expect(spec.credentials?.token).toBe('ghs_supersecret');
  });

  it('returns the spec unchanged when there are no credentials and the url is clean', () => {
    const spec: CheckoutSpec = {
      repositoryUrl: 'https://debug.local/debug-owner/platform.git',
      ref: 'main',
    };

    const redacted = redactCheckoutSpec(spec);

    expect(redacted).toBe(spec);
  });

  it('strips credentials embedded in repositoryUrl as a defense in depth', () => {
    const spec: CheckoutSpec = {
      repositoryUrl: 'https://x-access-token:ghs_supersecret@github.com/shipfox/platform.git',
      ref: 'main',
      credentials: {
        username: 'x-access-token',
        token: 'ghs_supersecret',
        expiresAt: new Date('2026-06-10T12:00:00.000Z'),
      },
    };

    const redacted = redactCheckoutSpec(spec);

    expect(redacted.repositoryUrl).toBe('https://github.com/shipfox/platform.git');
    expect(redacted.repositoryUrl).not.toContain('ghs_supersecret');
    expect(redacted.credentials?.token).toBe('***');
  });

  it('strips embedded credentials even when the spec has no credentials field', () => {
    const spec: CheckoutSpec = {
      repositoryUrl: 'https://x-access-token:ghs_supersecret@github.com/shipfox/platform.git',
      ref: 'main',
    };

    const redacted = redactCheckoutSpec(spec);

    expect(redacted.repositoryUrl).toBe('https://github.com/shipfox/platform.git');
    expect(redacted.repositoryUrl).not.toContain('ghs_supersecret');
  });
});
